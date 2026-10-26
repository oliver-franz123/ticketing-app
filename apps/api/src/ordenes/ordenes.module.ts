import { Module } from '@nestjs/common';
import { InventarioModule } from '../inventario/inventario.module';
import { OrdenesController } from './ordenes.controller';
import { OrdenesService } from './ordenes.service';

// Dueño de ordenes y orden_items (doc 03 §4). Los asientos los toma Inventario,
// con la transacción que le pasa Órdenes.
@Module({
  imports: [InventarioModule],
  controllers: [OrdenesController],
  providers: [OrdenesService],
})
export class OrdenesModule {}
