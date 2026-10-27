import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ZONA_HORARIA } from '@entradas/shared';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function bootstrap() {
  // rawBody: guarda los bytes originales del JSON en req.rawBody. La firma del
  // webhook de pagos se verifica sobre esos bytes, no sobre el JSON parseado
  // (doc 05 §4). Es una opción de creación: los e2e la pasan igual a
  // createNestApplication, no puede ir en configurarApp.
  const app = configurarApp(await NestFactory.create(AppModule, { rawBody: true }));
  app.enableShutdownHooks();

  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto);
  Logger.log(`API escuchando en el puerto ${puerto} (hora mostrada en ${ZONA_HORARIA})`, 'Arranque');
}

void bootstrap();
