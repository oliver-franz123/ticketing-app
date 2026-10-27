import type { ConfigService } from '@nestjs/config';
import { createPrivateKey, type KeyObject } from 'node:crypto';

const COMO_GENERARLA = 'Generarla con: npm run claves:qr -w @entradas/worker';

// Solo el Worker tiene la clave privada del QR (ADR-0011). Sin ella no puede
// emitir entradas: mejor no arrancar que reclamar filas del outbox y fallar en
// cada una. Formato: PKCS8 DER en base64, lo que imprime el script.
export function leerClavePrivadaQr(config: ConfigService): KeyObject {
  const valor = config.get<string>('QR_SIGNING_PRIVATE_KEY');
  if (!valor) {
    throw new Error(`Falta QR_SIGNING_PRIVATE_KEY. ${COMO_GENERARLA}`);
  }
  let clave: KeyObject;
  try {
    clave = createPrivateKey({ key: Buffer.from(valor, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error(`QR_SIGNING_PRIVATE_KEY no es una clave PKCS8 en base64. ${COMO_GENERARLA}`);
  }
  if (clave.asymmetricKeyType !== 'ed25519') {
    throw new Error(`QR_SIGNING_PRIVATE_KEY debe ser Ed25519 (es ${clave.asymmetricKeyType}). ${COMO_GENERARLA}`);
  }
  return clave;
}
