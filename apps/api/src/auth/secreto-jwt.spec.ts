import { ConfigService } from '@nestjs/config';
import { leerSecretoJwt } from './secreto-jwt';

const config = (JWT_SECRET?: string) => new ConfigService(JWT_SECRET === undefined ? {} : { JWT_SECRET });

describe('leerSecretoJwt', () => {
  const env = process.env.JWT_SECRET;
  beforeEach(() => delete process.env.JWT_SECRET);
  afterAll(() => (process.env.JWT_SECRET = env));

  it('falla si falta', () => {
    expect(() => leerSecretoJwt(config())).toThrow(/OTRA_COSA/);
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
