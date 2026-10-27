import type { ConfigService } from '@nestjs/config';
import { createPublicKey, type KeyObject } from 'node:crypto';

// Token de inyección de la clave pública (entradas.module.ts la crea con leerClavePublicaQr).
export const CLAVE_QR_PUBLICA = Symbol('CLAVE_QR_PUBLICA');

const COMO_GENERARLA = 'Generarla con: npm run claves:qr -w @entradas/worker';

// La API solo tiene la clave PÚBLICA del QR (ADR-0011): puede verificar, nunca
// firmar. Sin ella no hay validación en puerta, así que la API no arranca, igual
// que con JWT_SECRET. Formato: SPKI DER en base64, lo que imprime el script.
export function leerClavePublicaQr(config: ConfigService): KeyObject {
  const valor = config.get<string>('QR_SIGNING_PUBLIC_KEY');
  if (!valor) {
    throw new Error(`Falta QR_SIGNING_PUBLIC_KEY. ${COMO_GENERARLA}`);
  }
  let clave: KeyObject;
  try {
    clave = createPublicKey({ key: Buffer.from(valor, 'base64'), format: 'der', type: 'spki' });
  } catch {
    throw new Error(`QR_SIGNING_PUBLIC_KEY no es una clave SPKI en base64. ${COMO_GENERARLA}`);
  }
  if (clave.asymmetricKeyType !== 'ed25519') {
    throw new Error(`QR_SIGNING_PUBLIC_KEY debe ser Ed25519 (es ${clave.asymmetricKeyType}). ${COMO_GENERARLA}`);
  }
  return clave;
}
