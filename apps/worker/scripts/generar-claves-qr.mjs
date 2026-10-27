// Genera el par Ed25519 del QR firmado (ADR-0011) y lo imprime listo para
// pegar en .env, que no se versiona. Nunca commitear la salida.
//   npm run claves:qr -w @entradas/worker
// Formato: DER en base64 en una sola línea (PKCS8 la privada, SPKI la pública),
// porque un PEM con saltos de línea es frágil en variables de entorno.
import { generateKeyPairSync } from 'node:crypto';
import { stdout } from 'node:process';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privada = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const publica = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

// Solo el Worker lee la privada; la API (y el validador) solo la pública.
stdout.write(`QR_SIGNING_PRIVATE_KEY=${privada}\nQR_SIGNING_PUBLIC_KEY=${publica}\n`);
