import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearPagoSimuladorDto } from './dto/crear-pago-simulador.dto';

// Proveedor de pagos simulado (ADR-0015). Se comporta como un tercero: dueño
// solo de simulador_pagos, sin FK ni servicios de Órdenes o Pagos. Por ahora
// solo crea intentos; la página, los modos y el envío del webhook llegan después.
@Injectable()
export class SimuladorPagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async crear(datos: CrearPagoSimuladorDto) {
    // 128 bits aleatorios: la página de pago es pública y la referencia es lo
    // único que la protege.
    const referencia = `sim_pay_${randomBytes(16).toString('hex')}`;
    await this.prisma.simuladorPago.create({
      data: {
        referencia,
        ordenId: datos.ordenId.toLowerCase(),
        montoCentavos: BigInt(datos.montoCentavos),
        moneda: datos.moneda,
        // modo es NOT NULL pero se elige después en la página: mientras estado
        // sea PENDIENTE no significa nada y la confirmación lo pisa.
        modo: 'OK',
        // estado PENDIENTE, veces 1 e intentos_entrega 0 salen de los DEFAULT.
        // enviar_en NULL: no se envía ningún webhook hasta que el comprador confirme.
        enviarEn: null,
      },
    });
    return { referencia, redirectUrl: this.urlDePago(referencia) };
  }

  // Su propia URL pública, como la de cualquier proveedor. Se lee en cada uso,
  // igual que en el adaptador: los e2e la fijan después de listen.
  private urlDePago(referencia: string) {
    const base = (this.config.get<string>('API_PUBLIC_URL') ?? '').replace(/\/+$/, '');
    return `${base}/simulador/pagar/${encodeURIComponent(referencia)}`;
  }
}
