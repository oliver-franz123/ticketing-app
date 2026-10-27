import type { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { leerClavePrivadaQr } from './clave-qr';

// Sin la clave privada el Worker no puede emitir entradas: mejor no arrancar
// que procesar el outbox y fallar fila por fila.
// ConfigService de mentira: solo devuelve lo que pasa el caso. El real también
// lee process.env, y en CI ahí hay una clave válida (el caso "falta" no fallaba).
const configCon = (valor?: string) => {
  const valores: Record<string, string> = valor === undefined ? {} : { QR_SIGNING_PRIVATE_KEY: valor };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
};
const der = (tipo: 'ed25519' | 'x25519') =>
  generateKeyPairSync(tipo as 'ed25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

describe('leerClavePrivadaQr', () => {
  it('PKCS8 DER en base64 (lo que imprime el script) → clave privada Ed25519', () => {
    const clave = leerClavePrivadaQr(configCon(der('ed25519')));
    expect(clave.type).toBe('private');
    expect(clave.asymmetricKeyType).toBe('ed25519');
  });

  it.each([
    ['falta', undefined],
    ['vacía', ''],
    ['no es una clave', 'bm8tZXMtdW5hLWNsYXZl'],
  ])('%s → error que nombra la variable y el script', (_caso, valor) => {
    expect(() => leerClavePrivadaQr(configCon(valor))).toThrow(/QR_SIGNING_PRIVATE_KEY.*claves:qr/s);
  });

  it('una clave de otro tipo (X25519) → error', () => {
    expect(() => leerClavePrivadaQr(configCon(der('x25519')))).toThrow(/Ed25519/);
  });
});
