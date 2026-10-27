import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { leerClavePrivadaQr } from './clave-qr';

// Sin la clave privada el Worker no puede emitir entradas: mejor no arrancar
// que procesar el outbox y fallar fila por fila.
const configCon = (valor?: string) => new ConfigService(valor === undefined ? {} : { QR_SIGNING_PRIVATE_KEY: valor });
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
