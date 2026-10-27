import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CorreoService } from './email/correo.service';
import { EmitirEntradas } from './entradas/emitir-entradas';
import { OutboxRepositorio } from './outbox/outbox.repositorio';
import { ProcesadorOutbox } from './outbox/outbox.procesador';
import { PrismaService } from './prisma/prisma.service';
import { CLAVE_QR, leerClavePrivadaQr } from './qr/clave-qr';
import { RegistrarReembolso } from './reembolsos/registrar-reembolso';

@Module({
  imports: [
    // npm ejecuta los scripts del workspace desde apps/worker: el .env está en la raíz.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
  ],
  providers: [
    PrismaService,
    // Se lee al arrancar: sin clave válida el Worker no arranca (ADR-0011).
    { provide: CLAVE_QR, inject: [ConfigService], useFactory: leerClavePrivadaQr },
    OutboxRepositorio,
    ProcesadorOutbox,
    CorreoService,
    EmitirEntradas,
    RegistrarReembolso,
  ],
})
export class WorkerModule {}
