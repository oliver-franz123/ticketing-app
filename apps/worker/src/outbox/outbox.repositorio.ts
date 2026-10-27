import { Injectable } from '@nestjs/common';

export type TipoOutbox = 'ENTRADAS_EMITIDAS' | 'REEMBOLSO_REQUERIDO';

export interface FilaOutbox {
  id: bigint;
  tipo: TipoOutbox;
  payload: { ordenId: string };
  intentos: number;
}

export const LEASE_SEGUNDOS = 120;
export const LOTE = 10;

// Stub: el rojo de outbox.e2e-spec.ts es de comportamiento, no de compilación.
@Injectable()
export class OutboxRepositorio {
  async reclamar(lote = LOTE): Promise<FilaOutbox[]> {
    throw new Error(`no implementado (lote ${lote})`);
  }

  async marcarProcesado(id: bigint): Promise<void> {
    throw new Error(`no implementado (id ${id})`);
  }
}
