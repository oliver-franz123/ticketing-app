import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { verificarQr } from './qr';

// Firma a mano con node:crypto, igual que el Worker: el test no importa el
// código del Worker (otra app) y puede fabricar QR malos.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const firmar = (payload: unknown, clave = privateKey, prefijo = 'TKT1') => {
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${prefijo}.${bytes.toString('base64url')}.${sign(null, bytes, clave).toString('base64url')}`;
};

describe('verificarQr', () => {
  const payload = { t: randomUUID(), e: randomUUID(), i: 1_790_000_000 };

  it('un QR bien firmado devuelve el payload', () => {
    expect(verificarQr(firmar(payload), publicKey)).toEqual(payload);
  });

  it('tolera espacios o saltos de línea al pegarlo', () => {
    expect(verificarQr(`  ${firmar(payload)}\n`, publicKey)).toEqual(payload);
  });

  it('payload alterado con la firma original → null (A-05)', () => {
    const [prefijo, , firma] = firmar(payload).split('.');
    const otro = Buffer.from(JSON.stringify({ ...payload, t: randomUUID() })).toString('base64url');
    expect(verificarQr(`${prefijo}.${otro}.${firma}`, publicKey)).toBeNull();
  });

  it('firmado con otra clave → null', () => {
    expect(verificarQr(firmar(payload, generateKeyPairSync('ed25519').privateKey), publicKey)).toBeNull();
  });

  it.each([
    ['otro prefijo', firmar(payload, privateKey, 'TKT2')],
    ['sin partes', 'hola'],
    ['firma vacía', 'TKT1.e30.'],
    ['cuatro partes', `${firmar(payload)}.x`],
  ])('formato malo (%s) → null', (_caso, qr) => {
    expect(verificarQr(qr, publicKey)).toBeNull();
  });

  it.each([
    ['JSON que no es objeto', 42],
    ['t que no es UUID', { ...payload, t: '1' }],
    ['sin e', { t: payload.t, i: 1 }],
    ['i que no es número', { ...payload, i: '1' }],
  ])('firmado pero con payload inválido (%s) → null', (_caso, malo) => {
    expect(verificarQr(firmar(malo), publicKey)).toBeNull();
  });
});
