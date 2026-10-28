// Solo para la demo local: imprime el texto del QR (TKT1.…) de una entrada, el
// mismo que va en el PDF, para pegarlo en /validador sin escanear la imagen.
// Ed25519 es determinista y el payload sale de emitida_en, así que el
// resultado es idéntico al QR que firmó el Worker (apps/worker/src/qr/qr.ts).
//   npm run qr:entrada -w @entradas/worker -- <entradaId> <eventoId> <emitidaEnUnix>
// Lee QR_SIGNING_PRIVATE_KEY del entorno o del .env de la raíz. Nunca contra producción.
import { Buffer } from 'node:buffer';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { URL } from 'node:url';

const [entradaId, eventoId, emitida] = argv.slice(2);
if (!entradaId || !eventoId || !/^\d+$/.test(emitida ?? '')) {
  stderr.write('Uso: qr-de-entrada.mjs <entradaId> <eventoId> <emitidaEnUnix>\n');
  exit(1);
}

let privada = env.QR_SIGNING_PRIVATE_KEY;
if (!privada) {
  const texto = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
  privada = texto.split('\n').findLast((l) => l.startsWith('QR_SIGNING_PRIVATE_KEY='))?.slice(23).trim();
}
if (!privada) {
  stderr.write('Falta QR_SIGNING_PRIVATE_KEY (npm run claves:qr -w @entradas/worker)\n');
  exit(1);
}

const clave = createPrivateKey({ key: Buffer.from(privada, 'base64'), format: 'der', type: 'pkcs8' });
const bytes = Buffer.from(JSON.stringify({ t: entradaId, e: eventoId, i: Number(emitida) }), 'utf8');
stdout.write(`TKT1.${bytes.toString('base64url')}.${sign(null, bytes, clave).toString('base64url')}\n`);
