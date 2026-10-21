import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';

@Module({
  imports: [
    // npm ejecuta los scripts del workspace desde apps/api: el .env está en la raíz.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
