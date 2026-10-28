import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CABECERA_FIRMA_SIMULADOR, type CuerpoWebhookSimulador, type ModoSimulador } from '@entradas/shared';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ConfirmarPagoSimuladorDto } from './dto/confirmar-pago-simulador.dto';
import type { CrearPagoSimuladorDto } from './dto/crear-pago-simulador.dto';
import { firmar, leerSecretoFirma } from './firma';

export interface ResultadoDespacho {
  referencia: string;
  // Envíos HTTP en este despacho: DUPLICAR ×N manda N, DESORDEN manda 2.
  envios: number;
  // true si TODOS respondieron 2xx.
  entregado: boolean;
}

export type Confirmacion = 'CONFIRMADO' | 'YA_PROCESADO' | 'NO_EXISTE';

// Reintentos de entrega (ADR-0015), como un proveedor real: tras el 1.er
// intento fallido se espera 5 s, tras el 2.º 30 s, tras el 3.º 2 min y tras el
// 4.º 10 min. Si el 5.º también falla, se abandona (lo recuperaría la
// reconciliación con consultarEstado).
const BACKOFF_SEGUNDOS = [5, 30, 120, 600];

// Mientras una instancia envía, la fila queda "alquilada" 30 s: otra instancia
// no la toma. Si la que envía muere a la mitad, al vencer el lease otra la
// reintenta (al menos una vez; la API deduplica por el id del evento).
const LEASE_SEGUNDOS = 30;
const LOTE = 20;
const TIMEOUT_ENVIO_MS = 5000;
const TICK_MS_POR_DEFECTO = 1000;

interface FilaADespachar {
  referencia: string;
  orden_id: string;
  monto_centavos: bigint;
  moneda: string;
  modo: ModoSimulador;
  veces: number;
  intentos_entrega: number;
}

// Proveedor de pagos simulado (ADR-0015). Se comporta como un tercero: dueño
// solo de simulador_pagos, sin FK ni servicios de Órdenes o Pagos, y avisa
// SOLO por HTTP real a la URL pública (puede caer en otra instancia).
@Injectable()
export class SimuladorPagosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SimuladorPagosService.name);
  private readonly secreto: string;
  private tick?: NodeJS.Timeout;
  private despachando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.secreto = leerSecretoFirma(config);
  }

  // El tick vive en la API, no en el Worker: con el Worker caído se puede
  // seguir pagando (ADR-0015). SIMULADOR_TICK_MS=0 lo apaga (los e2e despachan
  // a mano para saber cuándo sale cada webhook).
  // Ausente o vacía (SIMULADOR_TICK_MS= en un .env) → 1 s; con ?? solo,
  // Number('') daría 0 y el tick se apagaría sin avisar. Excepción: con
  // NODE_ENV=test y sin valor explícito no hay timer, para que ningún test
  // reciba webhooks que no pidió. Un valor explícito manda siempre.
  onModuleInit() {
    const valor = this.config.get<string>('SIMULADOR_TICK_MS')?.trim();
    if (!valor && this.config.get<string>('NODE_ENV') === 'test') return;
    const ms = valor ? Number(valor) : TICK_MS_POR_DEFECTO;
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error('SIMULADOR_TICK_MS tiene que ser un entero >= 0 (0 apaga el despacho automático)');
    }
    if (ms > 0) this.tick = setInterval(() => void this.tickUnaVez(), ms);
  }

  onModuleDestroy() {
    clearInterval(this.tick);
  }

  async crear(datos: CrearPagoSimuladorDto) {
    // 128 bits aleatorios: la página de pago es pública y la referencia es lo
    // único que la protege.
    const referencia = `sim_pay_${randomBytes(16).toString('hex')}`;
    await this.prisma.simuladorPago.create({
      data: {
        referencia,
        ordenId: datos.ordenId.toLowerCase(),
        montoCentavos: BigInt(datos.montoCentavos),
        moneda: datos.moneda,
        // modo es NOT NULL pero se elige después en la página: mientras estado
        // sea PENDIENTE no significa nada y la confirmación lo pisa.
        modo: 'OK',
        // estado PENDIENTE, veces 1 e intentos_entrega 0 salen de los DEFAULT.
        // enviar_en NULL: no se envía ningún webhook hasta que el comprador confirme.
        enviarEn: null,
      },
    });
    return { referencia, redirectUrl: `${this.urlPublica()}/simulador/pagar/${encodeURIComponent(referencia)}` };
  }

  // Lo que muestra la página (ordenId, para el enlace de vuelta a la web).
  // findUnique es correcto: referencia es la PK.
  buscar(referencia: string) {
    return this.prisma.simuladorPago.findUnique({
      where: { referencia },
      select: { referencia: true, ordenId: true, montoCentavos: true, estado: true },
    });
  }

  // El comprador elige el modo en la página. UPDATE condicional: solo desde
  // PENDIENTE, así que un doble envío del formulario no cambia nada (409).
  // veces y la demora solo cuentan en su modo; en los demás, 1 y "ya".
  async confirmar(referencia: string, datos: ConfirmarPagoSimuladorDto): Promise<Confirmacion> {
    const veces = datos.modo === 'DUPLICAR' ? datos.veces! : 1;
    const demora = datos.modo === 'DEMORA' ? datos.s! : 0;
    const estado = datos.modo === 'RECHAZO' ? 'RECHAZADO' : 'PAGADO';

    const actualizadas = await this.prisma.$executeRaw`
      UPDATE simulador_pagos
      SET modo = ${datos.modo}, veces = ${veces}, estado = ${estado},
          enviar_en = now() + make_interval(secs => ${demora}::int)
      WHERE referencia = ${referencia} AND estado = 'PENDIENTE'`;
    if (actualizadas === 1) return 'CONFIRMADO';
    return (await this.buscar(referencia)) ? 'YA_PROCESADO' : 'NO_EXISTE';
  }

  // Envía los webhooks que ya tocan. Lease en UNA sentencia: toma las filas
  // vencidas que nadie más tiene (FOR UPDATE SKIP LOCKED) y les corre enviar_en
  // 30 s. El HTTP va DESPUÉS, sin transacción ni conexión retenida.
  // enviar_en <= now() deja fuera las filas con NULL (sin confirmar o ya entregadas).
  async despacharPendientes(): Promise<ResultadoDespacho[]> {
    const filas = await this.prisma.$queryRaw<FilaADespachar[]>`
      UPDATE simulador_pagos s
      SET enviar_en = now() + make_interval(secs => ${LEASE_SEGUNDOS}::int)
      FROM (
        SELECT referencia FROM simulador_pagos
        WHERE enviar_en <= now()
        ORDER BY enviar_en
        LIMIT ${LOTE}
        FOR UPDATE SKIP LOCKED
      ) p
      WHERE s.referencia = p.referencia
      RETURNING s.referencia, s.orden_id, s.monto_centavos, s.moneda, s.modo, s.veces, s.intentos_entrega`;
    return Promise.all(filas.map((fila) => this.despachar(fila)));
  }

  private async tickUnaVez() {
    // Un tick lento no se solapa con el siguiente en esta instancia; entre
    // instancias lo evita el lease.
    if (this.despachando) return;
    this.despachando = true;
    try {
      await this.despacharPendientes();
    } catch (error) {
      this.log.error(`despacho del simulador: ${(error as Error).message}`);
    } finally {
      this.despachando = false;
    }
  }

  private async despachar(fila: FilaADespachar): Promise<ResultadoDespacho> {
    const { envios, entregado } = await this.enviarSegunModo(fila);

    if (entregado) {
      await this.prisma.$executeRaw`UPDATE simulador_pagos SET enviar_en = NULL WHERE referencia = ${fila.referencia}`;
    } else {
      const intentos = fila.intentos_entrega + 1;
      const espera = BACKOFF_SEGUNDOS[intentos - 1];
      if (espera === undefined) {
        await this.prisma.$executeRaw`
          UPDATE simulador_pagos SET intentos_entrega = ${intentos}, enviar_en = NULL
          WHERE referencia = ${fila.referencia}`;
        this.log.error(`webhook ${fila.referencia}: ${intentos} intentos fallidos, se abandona`);
      } else {
        await this.prisma.$executeRaw`
          UPDATE simulador_pagos
          SET intentos_entrega = ${intentos}, enviar_en = now() + make_interval(secs => ${espera}::int)
          WHERE referencia = ${fila.referencia}`;
        this.log.warn(`webhook ${fila.referencia}: intento ${intentos} fallido, reintento en ${espera} s`);
      }
    }
    return { referencia: fila.referencia, envios, entregado };
  }

  private async enviarSegunModo(fila: FilaADespachar): Promise<{ envios: number; entregado: boolean }> {
    const exitoso = this.cuerpo(fila, 'pago.exitoso');
    switch (fila.modo) {
      case 'RECHAZO':
        return { envios: 1, entregado: await this.enviar(this.cuerpo(fila, 'pago.fallido')) };
      case 'DUPLICAR': {
        // El MISMO cuerpo (mismo id de evento) N veces a la vez.
        const respuestas = await Promise.all(Array.from({ length: fila.veces }, () => this.enviar(exitoso)));
        return { envios: respuestas.length, entregado: respuestas.every(Boolean) };
      }
      case 'DESORDEN':
        // El fallido sale solo después de que el exitoso fue aceptado. Si el
        // exitoso falla, se reintenta todo: la API deduplica el exitoso repetido.
        if (!(await this.enviar(exitoso))) return { envios: 1, entregado: false };
        return { envios: 2, entregado: await this.enviar(this.cuerpo(fila, 'pago.fallido')) };
      default:
        // OK y DEMORA (la demora ya está en enviar_en).
        return { envios: 1, entregado: await this.enviar(exitoso) };
    }
  }

  // Id determinista: sim_evt_<hex de la referencia>_exitoso | _fallido. Un
  // reintento lleva el MISMO id, como en un proveedor real; por eso la API
  // lo reconoce como duplicado.
  private cuerpo(fila: FilaADespachar, tipo: CuerpoWebhookSimulador['tipo']): string {
    const evento: CuerpoWebhookSimulador = {
      id: `${fila.referencia.replace('sim_pay_', 'sim_evt_')}_${tipo === 'pago.exitoso' ? 'exitoso' : 'fallido'}`,
      tipo,
      referencia: fila.referencia,
      ordenId: fila.orden_id,
      montoCentavos: Number(fila.monto_centavos),
      moneda: fila.moneda,
    };
    return JSON.stringify(evento);
  }

  // HTTP real a la URL pública (ADR-0015): pasa por el proxy y puede caer en
  // otra instancia. Se firma en cada envío (t nuevo). true solo con 2xx.
  private async enviar(cuerpo: string): Promise<boolean> {
    try {
      const respuesta = await fetch(`${this.urlPublica()}/webhooks/pagos/simulador`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [CABECERA_FIRMA_SIMULADOR]: firmar(this.secreto, cuerpo) },
        body: cuerpo,
        signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
      });
      // Se consume el cuerpo para liberar la conexión keep-alive.
      await respuesta.arrayBuffer();
      return respuesta.ok;
    } catch {
      return false;
    }
  }

  // Su propia URL pública, como la de cualquier proveedor. Se lee en cada uso:
  // los e2e la fijan después de listen. config.get no cachea.
  private urlPublica() {
    return (this.config.get<string>('API_PUBLIC_URL') ?? '').replace(/\/+$/, '');
  }
}
