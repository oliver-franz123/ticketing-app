// Contrato de pagos (T10, doc 05 §8, ADR-0015). Solo tipos y constantes: este
// paquete también lo importa la web, así que nada de node:crypto aquí. La firma
// la calcula cada lado por su cuenta, como lo harían dos sistemas distintos.

export type NombreProveedor = 'simulador' | 'stripe' | 'qr';

// ─── Puerto del dominio ──────────────────────────────────────────────────────

export interface OrdenParaPago {
  ordenId: string;
  montoCentavos: bigint;
  moneda: string;
}

export interface IntentoPago {
  // sim_pay_..., pi_...: va a pagos.referencia_externa.
  referenciaExterna: string;
  // Adónde mandar al comprador (página del simulador, Checkout, imagen del QR).
  // PagosService responde con redirectUrlDe(referencia) para que el pago nuevo
  // y el ya existente den la misma URL; este campo queda para adaptadores cuya
  // URL no se pueda reconstruir.
  redirectUrl: string;
}

// Lo único que ve PagosService.procesarWebhook, venga de quien venga. Las
// reglas (idempotencia, re-captura, entradas) se prueban una sola vez.
export interface EventoPagoNormalizado {
  proveedor: NombreProveedor;
  // Clave de idempotencia: UNIQUE(proveedor, evento_externo_id) (ADR-0004).
  eventoExternoId: string;
  referenciaExterna: string;
  ordenId: string;
  tipo: 'EXITOSO' | 'FALLIDO';
  // Se compara con la orden: si no coincide, REVISION_MANUAL (P-06). Por eso
  // moneda es string y no 'BOB': el proveedor podría mandar otra.
  montoCentavos: bigint;
  moneda: string;
}

// Respuesta de consultarEstado para la reconciliación.
export type EstadoPagoProveedor = 'PENDIENTE' | 'EXITOSO' | 'FALLIDO';

export type CabecerasHttp = Record<string, string | string[] | undefined>;

export interface ProveedorPago {
  readonly nombre: NombreProveedor;
  // Cuánto esperar antes de preguntar por un pago EN_PROCESO (doc 05 §8):
  // simulador y Stripe 10 min, QR bancario 1 min.
  readonly umbralReconciliacionMs: number;
  crearIntento(orden: OrdenParaPago): Promise<IntentoPago>;
  // Adónde mandar al comprador para un intento que YA existe (doble clic,
  // volver a la página de pago). Se arma desde la referencia guardada en
  // pagos, así todos los caminos devuelven la misma URL.
  redirectUrlDe(referenciaExterna: string): string;
  // rawBody: los bytes EXACTOS recibidos (Buffer en Node). Lanza si la firma no
  // es válida; el controlador lo traduce a 400 sin escribir nada.
  verificarYNormalizar(cabeceras: CabecerasHttp, rawBody: Uint8Array): EventoPagoNormalizado;
  consultarEstado(referenciaExterna: string): Promise<EstadoPagoProveedor>;
}

// ─── Contrato del simulador (lo que viaja por HTTP) ─────────────────────────

// Express pasa los nombres de cabecera a minúsculas.
// Valor: "t=<unix segundos>,v1=<hex>", v1 = HMAC-SHA256(secreto, "<t>.<rawBody>").
export const CABECERA_FIRMA_SIMULADOR = 'simulador-firma';

// Contra la repetición de webhooks viejos (replay): |ahora - t| <= 5 min.
export const TOLERANCIA_FIRMA_SEGUNDOS = 300;

export const MODOS_SIMULADOR = ['OK', 'RECHAZO', 'DUPLICAR', 'DEMORA', 'DESORDEN'] as const;
export type ModoSimulador = (typeof MODOS_SIMULADOR)[number];

export interface CuerpoWebhookSimulador {
  // sim_evt_...: el mismo en cada reintento de entrega, como un proveedor real.
  id: string;
  tipo: 'pago.exitoso' | 'pago.fallido';
  // sim_pay_...
  referencia: string;
  ordenId: string;
  // number y no bigint: JSON no tiene bigint. Un total en centavos cabe de
  // sobra en Number.MAX_SAFE_INTEGER; el adaptador lo pasa a bigint.
  montoCentavos: number;
  moneda: string;
}
