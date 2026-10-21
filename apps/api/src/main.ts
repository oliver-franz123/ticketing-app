import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ZONA_HORARIA } from '@entradas/shared';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function bootstrap() {
  const app = configurarApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();

  const puerto = Number(process.env.PORT ?? 3000);
  await app.listen(puerto);
  Logger.log(`API escuchando en el puerto ${puerto} (hora mostrada en ${ZONA_HORARIA})`, 'Arranque');
}

void bootstrap();
