import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';

// Firma QR TKT1 a mano, como firma-simulador-prueba.ts con los webhooks: el test
// no depende del código que prueba (la firma real vive en el Worker) y puede
// fabricar QR alterados o firmados con otra clave (A-05).
export function parQrDePrueba() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  // El mismo formato que imprime generar-claves-qr.mjs: SPKI DER en base64.
  const publicaBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { privada: privateKey, publicaBase64 };
}

export type PayloadQrPrueba = { t: string; e: string; i: number };

export function firmarQrPrueba(payload: PayloadQrPrueba | object, privada: KeyObject): string {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const firma = sign(null, bytes, privada);
  return `TKT1.${bytes.toString('base64url')}.${firma.toString('base64url')}`;
}
