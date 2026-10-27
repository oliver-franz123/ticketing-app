import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@entradas/db';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { UsuarioAutenticado } from '../auth/tipos';
import { aNumero } from '../catalogo/a-numero';
import { EstadoEvento } from '../catalogo/estados-evento';
import { InventarioService } from '../inventario/inventario.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearOrdenDto } from './dto/crear-orden.dto';
import { RESERVA_TTL_SEGUNDOS_POR_DEFECTO } from './limites';

interface EventoALaVenta {
  estado: string;
  venta_abierta: boolean;
  no_empezo: boolean;
}

interface OrdenVista {
  id: string;
  evento_id: string;
  estado: string;
  total_centavos: bigint;
  moneda: string;
  expires_at: Date;
}

interface OrdenInsertada {
  id: string;
  expires_at: Date;
  total_centavos: bigint;
}

// Los 409 llevan un `codigo` estable para que la web elija el mensaje.
const conflicto = (codigo: string, message: string, extra: object = {}) =>
  new ConflictException({ statusCode: 409, error: 'Conflict', codigo, message, ...extra });

// Dice QUÉ asientos faltan, nunca de quién son.
const asientosNoDisponibles = (noDisponibles: string[]) =>
  conflicto('ASIENTOS_NO_DISPONIBLES', 'Algunos asientos ya no están disponibles', { noDisponibles });

@Injectable()
export class OrdenesService {
  private readonly ttlSegundos: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    config: ConfigService,
  ) {
    this.ttlSegundos = Number(config.get('RESERVA_TTL_SEGUNDOS') ?? RESERVA_TTL_SEGUNDOS_POR_DEFECTO);
    if (!Number.isInteger(this.ttlSegundos) || this.ttlSegundos <= 0) {
      throw new Error('RESERVA_TTL_SEGUNDOS tiene que ser un entero positivo');
    }
  }

  // Reserva todo o nada en UNA transacción (doc 04 §4.1). READ COMMITTED, el
  // nivel por defecto: la correctitud la da el UPDATE condicional, no el aislamiento.
  // maxWait: en una carrera, 50 transacciones esperan una de las 10 conexiones del pool.
  crear(usuario: UsuarioAutenticado, clave: string, datos: CrearOrdenDto) {
    // Postgres devuelve los uuid en minúsculas: se normaliza para comparar con lo pedido.
    const eventoId = datos.eventoId.toLowerCase();
    const asientoIds = datos.asientoIds.map((id) => id.toLowerCase());
    const ordenId = randomUUID();

    return this.prisma.$transaction(
      async (tx) => {
        // A. El evento tiene que estar a la venta. Un BORRADOR da el mismo 404
        // que un id inexistente, como en el mapa. RN-09 con now() de Postgres,
        // nunca con la hora de la API.
        const [evento] = await tx.$queryRaw<EventoALaVenta[]>`
          SELECT estado, venta_inicio <= now() AS venta_abierta, inicio > now() AS no_empezo
          FROM eventos WHERE id = ${eventoId}::uuid`;
        if (!evento || evento.estado === EstadoEvento.BORRADOR) {
          throw new NotFoundException('Evento no encontrado');
        }
        if (evento.estado !== EstadoEvento.PUBLICADO) {
          throw conflicto('EVENTO_NO_DISPONIBLE', 'El evento no está a la venta');
        }
        if (!evento.venta_abierta) throw conflicto('VENTA_NO_ABIERTA', 'La venta todavía no abrió');
        if (!evento.no_empezo) throw conflicto('VENTA_CERRADA', 'La venta cerró: el evento ya empezó');

        // 0. RN-04 sin depender del job: si su orden pendiente en este evento ya
        // venció (y el Worker todavía no la marcó), se marca EXPIRADA para que el
        // índice parcial no bloquee la nueva. Sus asientos no se tocan: la
        // expiración perezosa ya los trata como libres.
        await tx.$executeRaw`
          UPDATE ordenes SET estado = 'EXPIRADA'
          WHERE usuario_id = ${usuario.id}::uuid
            AND evento_id  = ${eventoId}::uuid
            AND estado     = 'PENDIENTE_PAGO'
            AND expires_at < now()`;

        // 1. La orden primero: asientos.orden_id es una FK normal (no diferible).
        // El total sale del precio de cada zona al reservar (RN-05). COALESCE: si
        // ningún asiento es del evento, sum da NULL; con 0 se inserta y el paso 2
        // hace el ROLLBACK con 409.
        // ON CONFLICT DO NOTHING (sin columnas) cubre las dos claves únicas:
        // UNIQUE(usuario_id, idempotency_key) y el índice parcial de RN-04. Si otra
        // transacción acaba de insertar la misma clave, Postgres espera a que
        // termine antes de decidir: así 20 reintentos simultáneos crean una sola orden.
        const [orden] = await tx.$queryRaw<OrdenInsertada[]>`
          INSERT INTO ordenes (id, usuario_id, evento_id, estado, expires_at, extension_usada,
                               idempotency_key, total_centavos, moneda, nit, razon_social)
          VALUES (${ordenId}::uuid, ${usuario.id}::uuid, ${eventoId}::uuid, 'PENDIENTE_PAGO',
                  now() + make_interval(secs => ${this.ttlSegundos}::int), false, ${clave}::uuid,
                  COALESCE((SELECT sum(z.precio_centavos)
                              FROM asientos a JOIN zonas z ON z.id = a.zona_id
                             WHERE a.evento_id = ${eventoId}::uuid AND a.id = ANY(${asientoIds}::uuid[])), 0),
                  'BOB', ${datos.nit ?? null}, ${datos.razonSocial ?? null})
          ON CONFLICT DO NOTHING
          RETURNING id, expires_at, total_centavos`;
        if (!orden) return this.resolverConflicto(tx, usuario, clave, eventoId, asientoIds);

        // 2. Tomar los asientos (UPDATE condicional en Inventario).
        const tomados = await this.inventario.reservar(tx, {
          eventoId,
          ordenId,
          asientoIds,
          ttlSegundos: this.ttlSegundos,
        });

        // 3. Todo o nada (RN-03): si falta uno, la excepción hace ROLLBACK de la
        // orden y de los asientos que sí se tomaron.
        if (tomados.length < asientoIds.length) {
          throw asientosNoDisponibles(asientoIds.filter((id) => !tomados.includes(id)));
        }

        // Precio congelado por asiento (RN-05).
        await tx.$executeRaw`
          INSERT INTO orden_items (orden_id, asiento_id, precio_centavos)
          SELECT ${ordenId}::uuid, a.id, z.precio_centavos
          FROM asientos a JOIN zonas z ON z.id = a.zona_id
          WHERE a.id = ANY(${tomados}::uuid[])`;

        return respuesta({
          id: ordenId,
          eventoId,
          estado: 'PENDIENTE_PAGO',
          asientoIds: tomados,
          totalCentavos: orden.total_centavos,
          moneda: 'BOB',
          expiresAt: orden.expires_at,
        });
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }

  // Detalle para la página de la orden (la web hace polling hasta PAGADA). Solo
  // el dueño: el usuario va en el WHERE, así que una orden ajena da el mismo 404
  // que una inexistente (A-02). Expiración perezosa también aquí: una
  // PENDIENTE_PAGO vencida se informa como EXPIRADA aunque el job no haya
  // corrido, con now() de Postgres. Solo lectura: no la marca.
  async obtener(usuario: UsuarioAutenticado, id: string) {
    const [orden] = await this.prisma.$queryRaw<OrdenVista[]>`
      SELECT id, evento_id, total_centavos, moneda, expires_at,
             CASE WHEN estado = 'PENDIENTE_PAGO' AND expires_at < now() THEN 'EXPIRADA' ELSE estado END AS estado
        FROM ordenes
       WHERE id = ${id}::uuid AND usuario_id = ${usuario.id}::uuid`;
    if (!orden) throw new NotFoundException('Orden no encontrada');

    const asientos = await this.prisma.$queryRaw<{ id: string; fila: string; columna: number }[]>`
      SELECT a.id, a.fila, a.columna
        FROM orden_items i JOIN asientos a ON a.id = i.asiento_id
       WHERE i.orden_id = ${id}::uuid
       ORDER BY length(a.fila), a.fila, a.columna`;

    return {
      ordenId: orden.id,
      eventoId: orden.evento_id,
      estado: orden.estado,
      asientos,
      totalCentavos: aNumero(orden.total_centavos),
      moneda: orden.moneda,
      expiresAt: orden.expires_at,
    };
  }

  // El INSERT chocó con una clave única. Si este usuario ya tiene una orden con
  // esa clave, es un reintento: se devuelve la misma orden, con su estado
  // actual. Si no, el choque fue con RN-04. Solo se guardan los éxitos: un 409
  // hizo ROLLBACK, así que reintentar con la misma clave vuelve a intentar.
  private async resolverConflicto(
    tx: Prisma.TransactionClient,
    usuario: UsuarioAutenticado,
    clave: string,
    eventoId: string,
    asientoIds: string[],
  ) {
    // (usuario_id, idempotency_key) es un UNIQUE total, no parcial: findUnique
    // es correcto aquí (ADR-0016).
    const previa = await tx.orden.findUnique({
      where: { usuarioId_idempotencyKey: { usuarioId: usuario.id, idempotencyKey: clave } },
      include: { items: { select: { asientoId: true } } },
    });
    if (!previa) {
      throw conflicto('ORDEN_PENDIENTE_EXISTENTE', 'Ya tiene una reserva pendiente en este evento');
    }

    const asientosPrevios = previa.items.map((i) => i.asientoId);
    if (previa.eventoId !== eventoId || !mismosElementos(asientosPrevios, asientoIds)) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        codigo: 'IDEMPOTENCY_KEY_REUTILIZADA',
        message: 'La Idempotency-Key ya se usó para otra reserva',
      });
    }
    return respuesta({ ...previa, asientoIds: asientosPrevios });
  }
}

const mismosElementos = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

// Misma forma para la reserva nueva y para el reintento: el cliente no las distingue.
function respuesta(orden: {
  id: string;
  eventoId: string;
  estado: string;
  asientoIds: string[];
  totalCentavos: bigint;
  moneda: string;
  expiresAt: Date;
}) {
  return {
    ordenId: orden.id,
    eventoId: orden.eventoId,
    estado: orden.estado,
    asientoIds: [...orden.asientoIds].sort(),
    totalCentavos: aNumero(orden.totalCentavos),
    moneda: orden.moneda,
    expiresAt: orden.expiresAt,
  };
}
