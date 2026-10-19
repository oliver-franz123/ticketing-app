import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // Contexto de aplicación sin servidor HTTP: el Worker no expone puertos (doc 07).
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');
  logger.log('Worker iniciado (todavía sin colas)');

  // Hasta que existan consumidores de BullMQ (semana 4), nada mantiene vivo el
  // proceso. Este timer lo mantiene hasta recibir SIGINT/SIGTERM.
  const vivo = setInterval(() => {}, 60_000);

  const detener = async (senal: string) => {
    logger.log(`Recibido ${senal}: cerrando el Worker`);
    clearInterval(vivo);
    await app.close();
  };
  process.once('SIGINT', () => void detener('SIGINT'));
  process.once('SIGTERM', () => void detener('SIGTERM'));
}

void bootstrap();
