import { Module } from '@nestjs/common';
import { SimuladorPagosController } from './simulador-pagos.controller';
import { SimuladorPagosService } from './simulador-pagos.service';

// Solo local y demo (ADR-0015). No importa módulos de dominio: si se extrae a
// otro servicio, Órdenes y Pagos no cambian (solo API_PUBLIC_URL).
@Module({
  controllers: [SimuladorPagosController],
  providers: [SimuladorPagosService],
})
export class SimuladorPagosModule {}
