import type { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { leerClavePublicaQr } from './clave-qr';

// Sin la clave pública la API no puede validar en puerta: no arranca.
// ConfigService de mentira, como en el Worker: el real también lee process.env.
const configCon = (valor?: string) => {
  const valores: Record<string, string> = valor === undefined ? {} : { QR_SIGNING_PUBLIC_KEY: valor };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
};
const der = (tipo: 'ed25519' | 'x25519') =>
  generateKeyPairSync(tipo as 'ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

describe('leerClavePublicaQr', () => {
  it('SPKI DER en base64 (lo que imprime el script) → clave pública Ed25519', () => {
    const clave = leerClavePublicaQr(configCon(der('ed25519')));
    expect(clave.type).toBe('public');
    expect(clave.asymmetricKeyType).toBe('ed25519');
  });

  it.each([
    ['falta', undefined],
    ['vacía', ''],
    ['no es una clave', 'bm8tZXMtdW5hLWNsYXZl'],
  ])('%s → error que nombra la variable y el script', (_caso, valor) => {
    expect(() => leerClavePublicaQr(configCon(valor))).toThrow(/QR_SIGNING_PUBLIC_KEY.*claves:qr/s);
  });

  it('una clave de otro tipo (X25519) → error', () => {
    expect(() => leerClavePublicaQr(configCon(der('x25519')))).toThrow(/Ed25519/);
  });
});
