import { type KeyObject, sign, verify } from 'node:crypto';

// QR firmado con Ed25519 (ADR-0011, doc 05 §9): TKT1.<payload>.<firma>, ambos
// en base64url. El payload lleva solo IDs opacos y la fecha de emisión: una
// foto filtrada del QR no expone a nadie (doc 09 §7). El prefijo TKT1 deja
// lugar para un identificador de clave si algún día se rota.
export type PayloadQr = { t: string; e: string; i: number };
type EntradaQr = { id: string; eventoId: string; emitidaEn: Date };

const PREFIJO = 'TKT1';

// i sale de emitida_en, no de now(), y Ed25519 es determinista: reprocesar la
// misma entrada produce exactamente el mismo QR.
export function firmarQr(entrada: EntradaQr, clave: KeyObject): string {
  const payload: PayloadQr = { t: entrada.id, e: entrada.eventoId, i: Math.floor(entrada.emitidaEn.getTime() / 1000) };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  // Ed25519 no usa un hash aparte: el algoritmo va en null.
  const firma = sign(null, bytes, clave);
  return `${PREFIJO}.${bytes.toString('base64url')}.${firma.toString('base64url')}`;
}

// La firma se verifica sobre los bytes del payload tal como vinieron, antes de
// parsear el JSON. null = no es un QR nuestro (formato, firma o clave).
export function verificarQr(qr: string, clavePublica: KeyObject): PayloadQr | null {
  const partes = qr.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO) return null;
  const bytes = Buffer.from(partes[1], 'base64url');
  const firma = Buffer.from(partes[2], 'base64url');
  if (!verify(null, bytes, clavePublica, firma)) return null;
  return JSON.parse(bytes.toString('utf8')) as PayloadQr;
}
