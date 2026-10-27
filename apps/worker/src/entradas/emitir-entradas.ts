import { Injectable } from '@nestjs/common';

// Stub: el contenido aprobado llega en feat(worker): PDF y email de entradas.
@Injectable()
export class EmitirEntradas {
  async ejecutar(ordenId: string): Promise<void> {
    throw new Error(`no implementado (orden ${ordenId})`);
  }
}
