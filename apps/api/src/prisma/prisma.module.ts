import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: un único pool de conexiones para toda la API.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
