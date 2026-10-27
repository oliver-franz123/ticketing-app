import { type KeyObject, verify } from 'node:crypto';

// Verificación del QR firmado (ADR-0011, doc 05 §9): TKT1.<payload>.<firma>,
// ambos en base64url. La firma la hace el Worker (apps/worker/src/qr/qr.ts);
// aquí solo se verifica, con la clave pública. Vive en la API y no en
// packages/shared porque shared no puede importar node:crypto (lo usa la web).
export type PayloadQr = { t: string; e: string; i: number };

const PREFIJO = 'TKT1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La firma se verifica sobre los bytes del payload tal como vinieron, antes de
// parsear el JSON. null = no es un QR nuestro (formato, firma, clave o payload).
export function verificarQr(qr: string, clavePublica: KeyObject): PayloadQr | null {
  const partes = qr.trim().split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO) return null;
  const bytes = Buffer.from(partes[1], 'base64url');
  const firma = Buffer.from(partes[2], 'base64url');
  // Ed25519 firma siempre 64 bytes: con otro largo ni se intenta verificar.
  if (firma.length !== 64 || !verify(null, bytes, clavePublica, firma)) return null;

  // Firmado por nosotros, pero se valida la forma igual: el payload sale de la
  // BD sin pasar por un DTO y un bug del Worker no debe dar un 500 en la puerta.
  let payload: unknown;
  try {
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  const p = payload as Partial<PayloadQr> | null;
  if (!p || typeof p.t !== 'string' || typeof p.e !== 'string' || typeof p.i !== 'number') return null;
  if (!UUID.test(p.t) || !UUID.test(p.e)) return null;
  return { t: p.t.toLowerCase(), e: p.e.toLowerCase(), i: p.i };
}
