import { generateKeyPairSync } from 'node:crypto';
import { firmarQr, verificarQr } from './qr';

// QR firmado con Ed25519 (ADR-0011, doc 05 §9): TKT1.<payload>.<firma>, con
// payload {t, e, i} y sin datos personales.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const entrada = {
  id: '0b6f2a52-7c1e-4f4e-9a59-3d1c2e8b9f10',
  eventoId: '5d7e9c11-2a3b-4c5d-8e9f-0a1b2c3d4e5f',
  emitidaEn: new Date('2026-11-10T23:30:15.678Z'),
};

const partes = (qr: string) => qr.split('.');
const decodificar = (b64: string) => JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));

describe('QR firmado', () => {
  it('formato TKT1.<base64url>.<base64url> y payload con exactamente {t, e, i}', () => {
    const qr = firmarQr(entrada, privateKey);
    expect(qr).toMatch(/^TKT1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const payload = decodificar(partes(qr)[1]);
    expect(payload).toEqual({ t: entrada.id, e: entrada.eventoId, i: Math.floor(entrada.emitidaEn.getTime() / 1000) });
  });

  it('se verifica con la clave pública y devuelve el payload', () => {
    expect(verificarQr(firmarQr(entrada, privateKey), publicKey)).toEqual({
      t: entrada.id,
      e: entrada.eventoId,
      i: Math.floor(entrada.emitidaEn.getTime() / 1000),
    });
  });

  it('la misma entrada da exactamente el mismo QR: reprocesar no genera uno distinto', () => {
    expect(firmarQr(entrada, privateKey)).toBe(firmarQr(entrada, privateKey));
  });

  it('con otra clave pública → inválido', () => {
    const otra = generateKeyPairSync('ed25519').publicKey;
    expect(verificarQr(firmarQr(entrada, privateKey), otra)).toBeNull();
  });

  it('payload cambiado (otra entrada con la firma original) → inválido', () => {
    const [prefijo, , firma] = partes(firmarQr(entrada, privateKey));
    const falso = Buffer.from(JSON.stringify({ t: randomLike(entrada.id), e: entrada.eventoId, i: 1 })).toString('base64url');
    expect(verificarQr(`${prefijo}.${falso}.${firma}`, publicKey)).toBeNull();
  });

  it('firma alterada en un byte → inválido', () => {
    const [prefijo, payload, firma] = partes(firmarQr(entrada, privateKey));
    const bytes = Buffer.from(firma, 'base64url');
    bytes[0] ^= 0x01;
    expect(verificarQr(`${prefijo}.${payload}.${bytes.toString('base64url')}`, publicKey)).toBeNull();
  });

  it.each([
    ['otro prefijo', (qr: string) => qr.replace(/^TKT1/, 'TKT2')],
    ['sin firma', (qr: string) => partes(qr).slice(0, 2).join('.')],
    ['basura', () => 'no-es-un-qr'],
  ])('%s → inválido', (_caso, mutar) => {
    expect(verificarQr(mutar(firmarQr(entrada, privateKey)), publicKey)).toBeNull();
  });
});

// Mismo largo y formato que un UUID, distinto contenido.
function randomLike(uuid: string) {
  return uuid.replace(/[0-9a-f]/g, (c) => (c === 'f' ? '0' : 'f'));
}
