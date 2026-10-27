import { Module } from '@nestjs/common';
import { InventarioService } from './inventario.service';

// Dueño de asientos (doc 03 §4). No importa a Catálogo: la dependencia va en
// un solo sentido (Catálogo → Inventario), sin ciclos.
@Module({
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
