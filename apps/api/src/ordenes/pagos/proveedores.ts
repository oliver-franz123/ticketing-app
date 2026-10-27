import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NombreProveedor, ProveedorPago } from '@entradas/shared';
import { SimuladorAdapter } from './simulador.adapter';

// Adaptadores que existen en el código. stripe (opcional) y qr (futuro) se
// agregan aquí cuando se escriban (ADR-0015, doc 13).
const FABRICAS: Partial<Record<NombreProveedor, (config: ConfigService) => ProveedorPago>> = {
  simulador: (config) => new SimuladorAdapter(config),
};

// Strategy (doc 05 §8): PAYMENT_PROVIDERS dice qué adaptadores se registran y
// PAYMENT_PROVIDER_DEFAULT cuál se usa para los pagos nuevos. Los webhooks se
// enrutan por :proveedor, así un pago creado con otro default se sigue
// confirmando con su propio adaptador.
export class ProveedoresPago {
  private constructor(
    private readonly registrados: Map<string, ProveedorPago>,
    readonly porDefecto: ProveedorPago,
  ) {}

  // Solo se construyen los adaptadores habilitados: sin el simulador en la
  // lista, no se exige SIMULADOR_WEBHOOK_SECRET. Cualquier error de
  // configuración detiene el arranque, nunca el primer pago.
  static desdeConfig(config: ConfigService): ProveedoresPago {
    const nombres = (config.get<string>('PAYMENT_PROVIDERS') ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    if (nombres.length === 0) {
      throw new Error('Falta PAYMENT_PROVIDERS (por ejemplo: simulador)');
    }

    const registrados = new Map<string, ProveedorPago>();
    for (const nombre of nombres) {
      const fabrica = FABRICAS[nombre as NombreProveedor];
      if (!fabrica) throw new Error(`PAYMENT_PROVIDERS: el proveedor "${nombre}" no está implementado`);
      registrados.set(nombre, fabrica(config));
    }

    const porDefecto = registrados.get(config.get<string>('PAYMENT_PROVIDER_DEFAULT') ?? '');
    if (!porDefecto) {
      throw new Error('PAYMENT_PROVIDER_DEFAULT tiene que ser uno de PAYMENT_PROVIDERS');
    }
    return new ProveedoresPago(registrados, porDefecto);
  }

  // :proveedor viene de la URL. Uno no habilitado da 404: para quien envía,
  // esa ruta no existe.
  obtener(nombre: string): ProveedorPago {
    const proveedor = this.registrados.get(nombre);
    if (!proveedor) throw new NotFoundException('Proveedor de pago no encontrado');
    return proveedor;
  }
}
