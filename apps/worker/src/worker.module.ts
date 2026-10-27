import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    // npm ejecuta los scripts del workspace desde apps/worker: el .env está en la raíz.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
  ],
  providers: [PrismaService],
})
export class WorkerModule {}
