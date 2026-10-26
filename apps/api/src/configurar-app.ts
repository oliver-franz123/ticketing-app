import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Lo comparten main.ts y los e2e, para que los tests corran con la misma
// validación que producción.
export function configurarApp<T extends INestApplication>(app: T): T {
  // whitelist + forbidNonWhitelisted: un campo no declarado en el DTO (por
  // ejemplo `rol`) da 400 en vez de ignorarse en silencio.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // La web (*.vercel.app) y la API (*.fly.dev) están en sitios distintos (doc 07 §5).
  // Sin CORS_ORIGINS no se permite ningún origen externo. Sin credentials: el JWT
  // viaja en Authorization, no en cookies.
  const origenes = (app.get(ConfigService).get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origenes,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });
  return app;
}
