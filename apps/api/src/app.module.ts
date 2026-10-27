import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { OrdenesModule } from './ordenes/ordenes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SaludController } from './salud/salud.controller';
import { simuladorHabilitado } from './simulador-pagos/habilitado';
import { SimuladorPagosModule } from './simulador-pagos/simulador-pagos.module';

@Module({
  imports: [
    // npm ejecuta los scripts del workspace desde apps/api: el .env está en la raíz.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env'] }),
    PrismaModule,
    AuthModule,
    CatalogoModule,
    OrdenesModule,
    // Solo con SIMULADOR_HABILITADO=true exacto (ADR-0015): ver habilitado.ts.
    ConditionalModule.registerWhen(SimuladorPagosModule, simuladorHabilitado),
  ],
  controllers: [SaludController],
})
export class AppModule {}
