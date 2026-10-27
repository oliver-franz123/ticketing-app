import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type TipoOutbox = 'ENTRADAS_EMITIDAS' | 'REEMBOLSO_REQUERIDO';

export interface FilaOutbox {
  id: bigint;
  tipo: TipoOutbox;
  // Solo IDs (doc 09 §7).
  payload: { ordenId: string };
  // Ya contando este reclamo.
  intentos: number;
}

// Lease: más largo que el peor caso de una fila (PDF + SMTP con timeout de
// 30 s, ver CorreoService). Si el Worker muere, la fila vuelve a estar
// disponible cuando vence.
export const LEASE_SEGUNDOS = 120;
export const LOTE = 10;

// El outbox como cola, sin BullMQ (ADR-0017). Mismo patrón que
// despacharPendientes() del simulador de pagos.
@Injectable()
export class OutboxRepositorio {
  constructor(private readonly prisma: PrismaService) {}

  // Lease en UNA sentencia autocommit: toma las filas pendientes que nadie
  // tiene (FOR UPDATE SKIP LOCKED: si otro Worker las está reclamando, se
  // saltan sin esperar) y les pone reclamado_hasta. El trabajo lento va
  // DESPUÉS, sin transacción ni conexión retenida.
  // Si otro Worker hace COMMIT de su reclamo mientras esta sentencia espera,
  // FOR UPDATE vuelve a evaluar el WHERE sobre la versión nueva de la fila:
  // el lease vigente la deja fuera.
  async reclamar(lote = LOTE): Promise<FilaOutbox[]> {
    return this.prisma.$queryRaw<FilaOutbox[]>`
      UPDATE outbox o
      SET reclamado_hasta = now() + make_interval(secs => ${LEASE_SEGUNDOS}::int),
          intentos = o.intentos + 1
      FROM (
        SELECT id FROM outbox
        WHERE publicado_en IS NULL
          AND (reclamado_hasta IS NULL OR reclamado_hasta <= now())
        ORDER BY id
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
      ) p
      WHERE o.id = p.id
      RETURNING o.id, o.tipo, o.payload, o.intentos`;
  }

  // Solo después de procesar con éxito. Si falla o el Worker cae, la fila
  // queda pendiente y se reintenta al vencer el lease. publicado_en IS NULL:
  // si el lease venció y otro Worker también la terminó, no se pisa la fecha.
  async marcarProcesado(id: bigint): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox SET publicado_en = now(), reclamado_hasta = NULL
      WHERE id = ${id} AND publicado_en IS NULL`;
  }
}
