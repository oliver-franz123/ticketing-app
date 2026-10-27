import { Injectable } from '@nestjs/common';
import type { Prisma } from '@entradas/db';

// Dueño de la tabla entradas (doc 03 §4). Pagos le pasa su transacción: la
// emisión se confirma o se deshace junto con el pago. El QR y el PDF no van
// aquí: los genera el Worker después, a partir del outbox (doc 05 §6).
@Injectable()
export class EntradasService {
  // Una entrada EMITIDA por asiento de la orden, en UNA sentencia. Segunda red:
  // el índice único parcial ux_entrada_valida_por_asiento hace fallar el INSERT
  // si el asiento ya tiene una entrada válida (RN-01), aunque hubiera un bug arriba.
  // estado y emitida_en salen de los DEFAULT (EMITIDA, now()).
  async emitir(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, ordenId: string): Promise<number> {
    return tx.$executeRaw`
      INSERT INTO entradas (orden_id, asiento_id)
      SELECT orden_id, asiento_id FROM orden_items WHERE orden_id = ${ordenId}::uuid`;
  }
}
