import { Injectable } from '@nestjs/common';
import type { TipoOutbox } from './outbox.repositorio';

export interface ResultadoFila {
  id: bigint;
  tipo: TipoOutbox;
  // true = procesada y marcada (publicado_en). false = queda para el próximo lease.
  ok: boolean;
}

// Stub: el rojo de outbox.e2e-spec.ts es de comportamiento, no de compilación.
@Injectable()
export class ProcesadorOutbox {
  async procesarLote(): Promise<ResultadoFila[]> {
    throw new Error('no implementado');
  }
}
