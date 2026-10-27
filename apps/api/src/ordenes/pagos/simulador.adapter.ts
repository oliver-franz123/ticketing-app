import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CABECERA_FIRMA_SIMULADOR,
  type CabecerasHttp,
  type CuerpoWebhookSimulador,
  type EstadoPagoProveedor,
  type EventoPagoNormalizado,
  type IntentoPago,
  type OrdenParaPago,
  type ProveedorPago,
} from '@entradas/shared';
import { isUUID } from 'class-validator';
import { aNumero } from '../../catalogo/a-numero';
import { firmaSimuladorValida } from './firma-simulador';

// El secreto firma los webhooks: con uno corto, una sola firma capturada
// permite probar claves offline. Mismo criterio que JWT_SECRET (secreto-jwt.ts).
export function leerSecretoSimulador(config: ConfigService): string {
  const secreto = config.get<string>('SIMULADOR_WEBHOOK_SECRET');
  if (!secreto || Buffer.byteLength(secreto, 'utf8') < 32) {
    throw new Error('SIMULADOR_WEBHOOK_SECRET debe tener al menos 32 bytes. Generarlo con: openssl rand -base64 32');
  }
  return secreto;
}

// Mismo mensaje para todo: no se le dice a quien envía qué parte falló.
const firmaInvalida = () => new BadRequestException('Firma inválida');

// Un proveedor colgado no puede dejar al comprador esperando: a los 5 s se
// responde 502 y el comprador puede volver a tocar "Pagar".
const TIMEOUT_PROVEEDOR_MS = 5000;

// Formato de referencia que emite el simulador: 128 bits aleatorios en hex.
// No se puede adivinar, y eso importa porque la página de pago es pública.
const REFERENCIA_SIMULADOR = /^sim_pay_[0-9a-f]{32}$/;

const proveedorCaido = () => new BadGatewayException('El proveedor de pagos no respondió');

// Adaptador del simulador propio (ADR-0015, doc 05 §8). Traduce su formato al
// EventoPagoNormalizado; PagosService no sabe que existe un simulador.
@Injectable()
export class SimuladorAdapter implements ProveedorPago {
  readonly nombre = 'simulador' as const;
  // Mayor que la DEMORA más larga de la demo, para no adelantarse al webhook.
  readonly umbralReconciliacionMs = 10 * 60 * 1000;
  private readonly log = new Logger(SimuladorAdapter.name);
  private readonly secreto: string;

  constructor(private readonly config: ConfigService) {
    this.secreto = leerSecretoSimulador(config);
    // Falla al arrancar, no en el primer pago.
    this.urlPublica();
  }

  // Se habla con el simulador por HTTP y por la URL pública, como con un
  // tercero, aunque viva en la misma API (ADR-0015): extraerlo a otro servicio
  // es cambiar API_PUBLIC_URL. Cualquier falla del "proveedor" (red, timeout,
  // otro código o una respuesta rara) es un 502: el problema no es del comprador.
  async crearIntento(orden: OrdenParaPago): Promise<IntentoPago> {
    let respuesta: Response;
    try {
      respuesta = await fetch(`${this.urlPublica()}/simulador/pagos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ordenId: orden.ordenId,
          montoCentavos: aNumero(orden.montoCentavos),
          moneda: orden.moneda,
        }),
        signal: AbortSignal.timeout(TIMEOUT_PROVEEDOR_MS),
      });
    } catch (error) {
      // El detalle va al log, nunca al comprador (doc 09 §7: sin datos internos).
      const { name, message } = error as Error;
      this.log.warn(`crearIntento orden=${orden.ordenId}: sin respuesta del simulador (${name}: ${message})`);
      throw proveedorCaido();
    }
    if (respuesta.status !== 201) {
      this.log.warn(`crearIntento orden=${orden.ordenId}: el simulador respondió ${respuesta.status}`);
      throw proveedorCaido();
    }

    const { referencia } = (await respuesta.json().catch(() => ({}))) as { referencia?: unknown };
    if (typeof referencia !== 'string' || !REFERENCIA_SIMULADOR.test(referencia)) {
      this.log.warn(`crearIntento orden=${orden.ordenId}: referencia con formato inesperado`);
      throw proveedorCaido();
    }
    return { referenciaExterna: referencia, redirectUrl: this.redirectUrlDe(referencia) };
  }

  // Página de pago del simulador. Absoluta: el navegador llega desde la web,
  // que está en otro dominio. encodeURIComponent porque la referencia viene
  // de la BD y termina en una URL; con el formato de hoy no cambia nada.
  redirectUrlDe(referenciaExterna: string): string {
    return `${this.urlPublica()}/simulador/pagar/${encodeURIComponent(referenciaExterna)}`;
  }

  // Llega con la reconciliación, en otro slice.
  consultarEstado(): Promise<EstadoPagoProveedor> {
    throw new Error('SimuladorAdapter.consultarEstado todavía no está implementado');
  }

  // Primero la firma, después el JSON: un cuerpo sin firma válida no se parsea
  // (no se procesa nada que no venga del proveedor).
  verificarYNormalizar(cabeceras: CabecerasHttp, rawBody: Uint8Array): EventoPagoNormalizado {
    // Una cabecera repetida llega como array: es inválida, no se elige una.
    const cabecera = cabeceras[CABECERA_FIRMA_SIMULADOR];
    if (typeof cabecera !== 'string' || !firmaSimuladorValida(cabecera, rawBody, this.secreto)) {
      throw firmaInvalida();
    }

    let cuerpo: Partial<CuerpoWebhookSimulador>;
    try {
      cuerpo = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch {
      throw new BadRequestException('Cuerpo del webhook inválido');
    }
    const { id, tipo, referencia, ordenId, montoCentavos, moneda } = cuerpo ?? {};
    if (
      typeof id !== 'string' || !id.startsWith('sim_evt_') ||
      (tipo !== 'pago.exitoso' && tipo !== 'pago.fallido') ||
      typeof referencia !== 'string' || !referencia.startsWith('sim_pay_') ||
      typeof ordenId !== 'string' || !isUUID(ordenId) ||
      !Number.isSafeInteger(montoCentavos) || (montoCentavos as number) < 0 ||
      typeof moneda !== 'string'
    ) {
      throw new BadRequestException('Cuerpo del webhook inválido');
    }

    return {
      proveedor: this.nombre,
      eventoExternoId: id,
      referenciaExterna: referencia,
      // Postgres devuelve los uuid en minúsculas: se normaliza para comparar.
      ordenId: ordenId.toLowerCase(),
      tipo: tipo === 'pago.exitoso' ? 'EXITOSO' : 'FALLIDO',
      montoCentavos: BigInt(montoCentavos as number),
      moneda,
    };
  }

  // Se lee en cada uso y no en el constructor: así se puede cambiar sin
  // reiniciar (los e2e la fijan después de listen, con el puerto real).
  // config.get no cachea: lee process.env en cada llamada.
  private urlPublica(): string {
    const url = this.config.get<string>('API_PUBLIC_URL');
    if (!url) throw new Error('Falta API_PUBLIC_URL (por ejemplo: http://localhost:3000)');
    return url.replace(/\/+$/, '');
  }
}
