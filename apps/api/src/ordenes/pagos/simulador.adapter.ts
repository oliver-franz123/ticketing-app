import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CABECERA_FIRMA_SIMULADOR,
  type CabecerasHttp,
  type CuerpoWebhookSimulador,
  type EstadoPagoProveedor,
  type EventoPagoNormalizado,
  type IntentoPago,
  type ProveedorPago,
} from '@entradas/shared';
import { isUUID } from 'class-validator';
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

// Adaptador del simulador propio (ADR-0015, doc 05 §8). Traduce su formato al
// EventoPagoNormalizado; PagosService no sabe que existe un simulador.
@Injectable()
export class SimuladorAdapter implements ProveedorPago {
  readonly nombre = 'simulador' as const;
  // Mayor que la DEMORA más larga de la demo, para no adelantarse al webhook.
  readonly umbralReconciliacionMs = 10 * 60 * 1000;
  private readonly secreto: string;

  constructor(config: ConfigService) {
    this.secreto = leerSecretoSimulador(config);
  }

  // Llega con POST /ordenes/:id/pago (commit 6), con su propio test primero.
  crearIntento(): Promise<IntentoPago> {
    throw new Error('SimuladorAdapter.crearIntento todavía no está implementado');
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
}
