import { ConfigService } from '@nestjs/config';

// HS256 con una clave corta se rompe por fuerza bruta offline a partir de un
// solo token: se exige el largo del hash (32 bytes) y la API no arranca sin él.
export function leerSecretoJwt(config: ConfigService): string {
  const secreto = config.get<string>('JWT_SECRET');
  if (!secreto) {
    throw new Error('Falta JWT_SECRET. Generarlo con: openssl rand -base64 32');
  }
  if (Buffer.byteLength(secreto, 'utf8') < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 bytes. Generarlo con: openssl rand -base64 32');
  }
  return secreto;
}
