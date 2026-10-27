import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// REEMBOLSO_REQUERIDO (P-04): el proveedor cobró, pero la orden no pudo
// recuperar sus asientos. En este slice solo se deja constancia en el log: la
// devolución es manual y no hay email ni tabla (fuera de alcance).
@Injectable()
export class RegistrarReembolso {
  private readonly log = new Logger('Reembolsos');

  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(ordenId: string): Promise<void> {
    const [orden] = await this.prisma.$queryRaw<{ total_centavos: bigint; moneda: string }[]>`
      SELECT total_centavos, moneda FROM ordenes WHERE id = ${ordenId}::uuid`;
    if (!orden) throw new Error(`orden ${ordenId} no existe`);
    // Una línea JSON: fácil de filtrar en `fly logs`. Montos en centavos (ADR-0010).
    this.log.warn(
      JSON.stringify({
        evento: 'REEMBOLSO_REQUERIDO',
        ordenId,
        totalCentavos: orden.total_centavos.toString(),
        moneda: orden.moneda,
      }),
    );
  }
}
