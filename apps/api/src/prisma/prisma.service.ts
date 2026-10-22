import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, PrismaPg } from '@entradas/db';

// Runtime: DATABASE_URL (en Supabase, el pooler en modo transacción). DIRECT_URL
// es solo para el CLI de migraciones (prisma.config.ts).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }) });
  }

  onModuleInit() {
    return this.$connect();
  }

  onModuleDestroy() {
    return this.$disconnect();
  }
}
