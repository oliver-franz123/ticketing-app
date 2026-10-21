import { createHmac } from 'node:crypto';

// Arma JWT a mano con node:crypto para que los tests no dependan de la
// librería que se está probando y puedan fabricar tokens maliciosos.
const b64url = (valor: object | Buffer) =>
  (Buffer.isBuffer(valor) ? valor : Buffer.from(JSON.stringify(valor))).toString('base64url');

export function firmarHs256(payload: object, secreto: string, header: object = { alg: 'HS256', typ: 'JWT' }) {
  const cuerpo = `${b64url(header)}.${b64url(payload)}`;
  const firma = createHmac('sha256', secreto).update(cuerpo).digest('base64url');
  return `${cuerpo}.${firma}`;
}

export function sinFirma(payload: object) {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
}

export const ahora = () => Math.floor(Date.now() / 1000);
