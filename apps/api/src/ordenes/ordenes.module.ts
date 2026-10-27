import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntradasModule } from '../entradas/entradas.module';
import { InventarioModule } from '../inventario/inventario.module';
import { OrdenesController } from './ordenes.controller';
import { OrdenesService } from './ordenes.service';
import { PagosService } from './pagos/pagos.service';
import { ProveedoresPago } from './pagos/proveedores';
import { WebhooksController } from './pagos/webhooks.controller';

// Órdenes y Pagos (doc 03 §4): dueño de ordenes, orden_items, pagos y
// webhook_eventos. Los asientos los toma Inventario y las entradas las emite
// Entradas, siempre con la transacción que les pasa este módulo.
@Module({
  imports: [InventarioModule, EntradasModule],
  controllers: [OrdenesController, WebhooksController],
  providers: [
    OrdenesService,
    PagosService,
    // Strategy (doc 05 §8): solo se construyen los adaptadores de
    // PAYMENT_PROVIDERS. Una configuración inválida detiene el arranque.
    { provide: ProveedoresPago, inject: [ConfigService], useFactory: ProveedoresPago.desdeConfig },
  ],
})
export class OrdenesModule {}
