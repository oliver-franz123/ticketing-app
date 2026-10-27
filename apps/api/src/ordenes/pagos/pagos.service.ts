import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@entradas/db';
import type { CabecerasHttp, EventoPagoNormalizado } from '@entradas/shared';
import { createHash } from 'node:crypto';
import type { UsuarioAutenticado } from '../../auth/tipos';
import { EntradasService } from '../../entradas/entradas.service';
import { InventarioService } from '../../inventario/inventario.service';
import { registrarEnOutbox } from '../../outbox/registrar';
import { PrismaService } from '../../prisma/prisma.service';
import { ProveedoresPago } from './proveedores';

// Qué pasó con cada webhook. Va a los logs; el proveedor siempre recibe 200.
export type ResultadoWebhook =
  | 'REFERENCIA_DESCONOCIDA'
  | 'DUPLICADO'
  | 'PAGO_FALLIDO'
  | 'ORDEN_YA_RESUELTA'
  | 'REVISION_MANUAL'
  | 'PAGADA'
  | 'REEMBOLSO_REQUERIDO';

interface PagoFila {
  id: string;
  orden_id: string;
}

interface OrdenFila {
  estado: string;
  total_centavos: bigint;
  moneda: string;
}

interface OrdenAPagar {
  estado: string;
  total_centavos: bigint;
  moneda: string;
  // expires_at > now() calculado por Postgres: nunca con la hora de la API.
  vigente: boolean;
}

const ordenNoPagable = () =>
  new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    codigo: 'ORDEN_NO_PAGABLE',
    message: 'La orden ya no se puede pagar',
  });

// Estados desde los que un pago exitoso puede confirmar la orden (doc 04 §1).
const ESTADOS_COBRABLES = ['PENDIENTE_PAGO', 'EXPIRADA'];

// Órdenes y Pagos (doc 03 §4): dueño de pagos y webhook_eventos. Solo ve
// EventoPagoNormalizado: las reglas valen igual para el simulador, Stripe o el
// QR bancario (doc 05 §8).
@Injectable()
export class PagosService {
  private readonly log = new Logger(PagosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    private readonly entradas: EntradasService,
    private readonly proveedores: ProveedoresPago,
  ) {}

  // POST /ordenes/:id/pago (doc 05 §4). Sin transacción alrededor del HTTP: el
  // simulador vive en esta misma API y necesita su propia conexión del pool;
  // retener una mientras se lo espera agota el pool con pocos pagos a la vez.
  // La regla "un solo cobro vivo por orden" la garantiza la base, con el índice
  // único parcial ux_pago_en_proceso_por_orden.
  async iniciarPago(usuario: UsuarioAutenticado, ordenId: string) {
    const id = ordenId.toLowerCase();

    // 1. Ajena o inexistente: el mismo 404, no se revela que existe.
    const [orden] = await this.prisma.$queryRaw<OrdenAPagar[]>`
      SELECT estado, total_centavos, moneda, expires_at > now() AS vigente
      FROM ordenes
      WHERE id = ${id}::uuid AND usuario_id = ${usuario.id}::uuid`;
    if (!orden) throw new NotFoundException('Orden no encontrada');
    // Antes que buscar un pago vivo: una orden vencida no se paga aunque haya
    // un intento abierto (si ese intento cobra igual, lo resuelve la re-captura).
    if (orden.estado !== 'PENDIENTE_PAGO' || !orden.vigente) throw ordenNoPagable();

    // 2. Doble clic o volver a la página de pago: el intento que ya existe.
    const vivo = await this.pagoEnProceso(id);
    if (vivo) return this.respuestaPago(vivo);

    // 3. El proveedor crea el intento. Sin conexión retenida.
    const proveedor = this.proveedores.porDefecto;
    const intento = await proveedor.crearIntento({
      ordenId: id,
      montoCentavos: orden.total_centavos,
      moneda: orden.moneda,
    });

    // 4. Se inserta solo si la orden SIGUE siendo pagable en este instante: el
    // WHERE se evalúa en la misma sentencia que el INSERT, así que no hay
    // hueco entre comprobar y escribir. El monto sale de la orden, no del
    // intento. ON CONFLICT DO NOTHING (sin columnas) cubre el índice parcial:
    // si otro clic insertó antes, esta sentencia espera a que termine y no
    // inserta nada.
    const insertado = await this.prisma.$queryRaw<{ proveedor: string; referencia_externa: string }[]>`
      INSERT INTO pagos (orden_id, proveedor, referencia_externa, estado, monto_centavos, moneda)
      SELECT o.id, ${proveedor.nombre}, ${intento.referenciaExterna}, 'EN_PROCESO', o.total_centavos, o.moneda
      FROM ordenes o
      WHERE o.id = ${id}::uuid
        AND o.usuario_id = ${usuario.id}::uuid
        AND o.estado = 'PENDIENTE_PAGO'
        AND o.expires_at > now()
      ON CONFLICT DO NOTHING
      RETURNING proveedor, referencia_externa`;
    if (insertado.length > 0) {
      return this.respuestaPago({ proveedor: insertado[0].proveedor, referenciaExterna: insertado[0].referencia_externa });
    }

    // 5. 0 filas: perdió el doble clic (devuelve la URL del ganador) o la orden
    // dejó de ser pagable mientras se esperaba al proveedor. El intento
    // huérfano del proveedor queda sin usar: el webhook solo actúa sobre
    // referencias que están en pagos.
    const ganador = await this.pagoEnProceso(id);
    if (ganador) return this.respuestaPago(ganador);
    throw ordenNoPagable();
  }

  // El índice es parcial: findFirst con el estado, nunca findUnique (ADR-0016).
  private pagoEnProceso(ordenId: string) {
    return this.prisma.pago.findFirst({
      where: { ordenId, estado: 'EN_PROCESO' },
      select: { proveedor: true, referenciaExterna: true },
    });
  }

  // Siempre desde la referencia guardada: el pago nuevo, el que ya existía y el
  // perdedor del doble clic devuelven exactamente lo mismo. Con el adaptador
  // del pago, no con el default: el default pudo cambiar después de crearlo.
  private respuestaPago(pago: { proveedor: string; referenciaExterna: string }) {
    return {
      proveedor: pago.proveedor,
      redirectUrl: this.proveedores.obtener(pago.proveedor).redirectUrlDe(pago.referenciaExterna),
    };
  }

  // Firma primero y fuera de la transacción: un webhook falso no abre una
  // conexión ni escribe nada (400). Después, todo en UNA transacción: si algo
  // falla, ROLLBACK, 500 y el proveedor reintenta.
  async procesarWebhook(nombreProveedor: string, cabeceras: CabecerasHttp, rawBody: Uint8Array | undefined) {
    const proveedor = this.proveedores.obtener(nombreProveedor);
    // Sin rawBody (Content-Type que no es JSON) no hay bytes que verificar.
    if (!rawBody) throw new BadRequestException('Cuerpo del webhook inválido');
    const evento = proveedor.verificarYNormalizar(cabeceras, rawBody);
    // Se guarda el hash, nunca el cuerpo (doc 09 §7).
    const sha256 = createHash('sha256').update(rawBody).digest('hex');

    const resultado = await this.prisma.$transaction((tx) => this.aplicar(tx, evento, sha256), {
      maxWait: 5000,
      timeout: 5000,
    });
    const nivel = resultado === 'REFERENCIA_DESCONOCIDA' || resultado === 'REEMBOLSO_REQUERIDO' ? 'warn' : 'log';
    this.log[nivel](`webhook ${evento.proveedor}/${evento.eventoExternoId} orden=${evento.ordenId}: ${resultado}`);
    return resultado;
  }

  private async aplicar(
    tx: Prisma.TransactionClient,
    evento: EventoPagoNormalizado,
    sha256: string,
  ): Promise<ResultadoWebhook> {
    // 1. El pago tiene que existir y ser de esa orden. Si no, NO se registra
    // el evento: si llegó antes de que el pago fuera visible, un reenvío o la
    // reconciliación lo procesarán. Se consulta antes del INSERT, así no hay
    // nada que deshacer.
    const [pago] = await tx.$queryRaw<PagoFila[]>`
      SELECT id, orden_id FROM pagos
      WHERE proveedor = ${evento.proveedor} AND referencia_externa = ${evento.referenciaExterna}`;
    if (!pago || pago.orden_id !== evento.ordenId) return 'REFERENCIA_DESCONOCIDA';

    // 2. Idempotencia (ADR-0004). Con 5 copias simultáneas, las que chocan con
    // UNIQUE(proveedor, evento_externo_id) ESPERAN a que termine la primera; si
    // hace COMMIT, devuelven 0 filas y no tocan nada. Si hace ROLLBACK, una de
    // ellas inserta y procesa: el evento nunca se pierde.
    const registrado = await tx.$queryRaw<{ id: bigint }[]>`
      INSERT INTO webhook_eventos (proveedor, evento_externo_id, tipo, payload_sha256)
      VALUES (${evento.proveedor}, ${evento.eventoExternoId}, ${evento.tipo}, ${sha256})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (registrado.length === 0) return 'DUPLICADO';

    // 3. Serializa los webhooks de la misma orden (dos eventos distintos del
    // mismo cobro, P-07). Orden de bloqueo: orden → asientos (ORDER BY id).
    const [orden] = await tx.$queryRaw<OrdenFila[]>`
      SELECT estado, total_centavos, moneda FROM ordenes
      WHERE id = ${evento.ordenId}::uuid
      FOR UPDATE`;

    // Rechazo: solo el pago. La orden sigue PENDIENTE_PAGO hasta su expires_at
    // y el comprador puede reintentar. Exigir EN_PROCESO hace que un FALLIDO
    // que llega después de un EXITOSO no revierta nada (P-05).
    if (evento.tipo === 'FALLIDO') {
      await tx.$executeRaw`UPDATE pagos SET estado = 'FALLIDO' WHERE id = ${pago.id}::uuid AND estado = 'EN_PROCESO'`;
      return 'PAGO_FALLIDO';
    }

    // El dinero llegó: el pago queda CONFIRMADO pase lo que pase con la orden.
    // Incluso desde FALLIDO, si el proveedor reintentó y esta vez cobró.
    const confirmarPago = () =>
      tx.$executeRaw`UPDATE pagos SET estado = 'CONFIRMADO' WHERE id = ${pago.id}::uuid AND estado <> 'CONFIRMADO'`;

    if (!ESTADOS_COBRABLES.includes(orden.estado)) {
      await confirmarPago();
      return 'ORDEN_YA_RESUELTA';
    }

    // P-06: un monto o una moneda distintos no emiten nada; lo revisa una persona.
    if (evento.montoCentavos !== orden.total_centavos || evento.moneda !== orden.moneda) {
      await tx.$executeRaw`
        UPDATE ordenes SET estado = 'REVISION_MANUAL'
        WHERE id = ${evento.ordenId}::uuid AND estado IN ('PENDIENTE_PAGO', 'EXPIRADA')`;
      await confirmarPago();
      return 'REVISION_MANUAL';
    }

    return this.confirmarOrden(tx, evento.ordenId, confirmarPago);
  }

  // Re-captura todo o nada (doc 04 §4.3). El SAVEPOINT permite deshacer solo
  // los asientos que se alcanzaron a marcar VENDIDO, sin perder la fila de
  // webhook_eventos: si se perdiera, el reintento del proveedor volvería a
  // procesar el evento.
  private async confirmarOrden(
    tx: Prisma.TransactionClient,
    ordenId: string,
    confirmarPago: () => Promise<number>,
  ): Promise<ResultadoWebhook> {
    const [{ items }] = await tx.$queryRaw<{ items: number }[]>`
      SELECT count(*)::int AS items FROM orden_items WHERE orden_id = ${ordenId}::uuid`;
    if (items === 0) throw new Error(`La orden ${ordenId} no tiene asientos`);

    await tx.$executeRaw`SAVEPOINT recaptura`;
    const vendidos = await this.inventario.recapturar(tx, ordenId);

    if (vendidos.length === items) {
      await tx.$executeRaw`RELEASE SAVEPOINT recaptura`;
      await tx.$executeRaw`
        UPDATE ordenes SET estado = 'PAGADA'
        WHERE id = ${ordenId}::uuid AND estado IN ('PENDIENTE_PAGO', 'EXPIRADA')`;
      await confirmarPago();
      // Defensa en profundidad: una entrada por asiento, ni más ni menos. Si no
      // cuadra, el error hace ROLLBACK de todo (también del webhook) y el
      // proveedor reintenta.
      const emitidas = await this.entradas.emitir(tx, ordenId);
      if (emitidas !== items) {
        throw new Error(`Orden ${ordenId}: se emitieron ${emitidas} entradas para ${items} asientos`);
      }
      await registrarEnOutbox(tx, 'ENTRADAS_EMITIDAS', { ordenId });
      return 'PAGADA';
    }

    // Faltó alguno: ningún asiento queda VENDIDO a medias. El cobro existe,
    // así que la orden pasa a REEMBOLSO_REQUERIDO y se liberan los asientos
    // que todavía eran suyos.
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT recaptura`;
    await tx.$executeRaw`
      UPDATE ordenes SET estado = 'REEMBOLSO_REQUERIDO'
      WHERE id = ${ordenId}::uuid AND estado IN ('PENDIENTE_PAGO', 'EXPIRADA')`;
    await confirmarPago();
    await this.inventario.liberarDeOrden(tx, ordenId);
    await registrarEnOutbox(tx, 'REEMBOLSO_REQUERIDO', { ordenId });
    return 'REEMBOLSO_REQUERIDO';
  }
}
