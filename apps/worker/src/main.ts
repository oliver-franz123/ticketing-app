import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  // Contexto de aplicación sin servidor HTTP: el Worker no expone puertos (doc 07).
  // El tick de ProcesadorOutbox mantiene vivo el proceso (ADR-0017).
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger('Worker');
  logger.log('Worker iniciado: consumiendo el outbox');

  const detener = async (senal: string) => {
    logger.log(`Recibido ${senal}: cerrando el Worker`);
    await app.close();
  };
  process.once('SIGINT', () => void detener('SIGINT'));
  process.once('SIGTERM', () => void detener('SIGTERM'));
}

void bootstrap();
