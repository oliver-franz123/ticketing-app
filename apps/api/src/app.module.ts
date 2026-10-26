import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { OrdenesModule } from './ordenes/ordenes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';

@Module({
  imports: [
    // npm ejecuta los scripts del workspace desde apps/api: el .env está en la raíz.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
    AuthModule,
    CatalogoModule,
    OrdenesModule,
  ],
  controllers: [SaludController],
})
export class AppModule {}
