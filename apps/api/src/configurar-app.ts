import { INestApplication, ValidationPipe } from '@nestjs/common';

// Lo comparten main.ts y los e2e, para que los tests corran con la misma
// validación que producción.
export function configurarApp<T extends INestApplication>(app: T): T {
  // whitelist + forbidNonWhitelisted: un campo no declarado en el DTO (por
  // ejemplo `rol`) da 400 en vez de ignorarse en silencio.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  return app;
}
