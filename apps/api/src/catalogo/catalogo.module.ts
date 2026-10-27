import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';
import { RecintosController } from './recintos.controller';

// Dueño de departamentos, ciudades, recintos, eventos y zonas (doc 03 §4).
// Los asientos los escribe Inventario, con la transacción que le pasa Catálogo.
@Module({
  imports: [InventarioModule],
  controllers: [EventosController, RecintosController],
  providers: [EventosService],
})
export class CatalogoModule {}
