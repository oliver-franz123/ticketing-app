import type { ConfigService } from '@nestjs/config';
import { leerSecretoJwt } from './secreto-jwt';

// ConfigService de mentira: solo devuelve lo que pasa el caso. El real también
// lee process.env, y en CI ahí está el JWT_SECRET del workflow.
const config = (JWT_SECRET?: string) => {
  const valores: Record<string, string> = JWT_SECRET === undefined ? {} : { JWT_SECRET };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService;
};

describe('leerSecretoJwt', () => {
  it('falla si falta', () => {
    expect(() => leerSecretoJwt(config())).toThrow(/JWT_SECRET/);
  });

  it('falla si está vacío', () => {
    expect(() => leerSecretoJwt(config(''))).toThrow(/JWT_SECRET/);
  });

  it('falla con menos de 32 bytes', () => {
    expect(() => leerSecretoJwt(config('a'.repeat(31)))).toThrow(/32 bytes/);
  });

  it('acepta 32 bytes o más', () => {
    expect(leerSecretoJwt(config('a'.repeat(32)))).toBe('a'.repeat(32));
  });
});
