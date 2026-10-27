import type { Prisma } from '@entradas/db';

// Tipos de mensaje del outbox (doc 09: tabla outbox). El relay y el Worker que
// los consumen llegan en otro slice; hasta entonces las filas esperan con
// publicado_en = NULL, que es justo lo que garantiza el patrón.
export type TipoOutbox = 'ENTRADAS_EMITIDAS' | 'REEMBOLSO_REQUERIDO';

// Outbox transaccional (ADR-0005, doc 05 §6): la intención de encolar se
// escribe en la MISMA transacción que el cambio de negocio. Si hay COMMIT, el
// trabajo pendiente es durable aunque Redis esté caído; si hay ROLLBACK,
// desaparece con todo lo demás. El payload lleva solo IDs (doc 09 §7).
export async function registrarEnOutbox(
  tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
  tipo: TipoOutbox,
  payload: { ordenId: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO outbox (tipo, payload)
    VALUES (${tipo}, ${JSON.stringify(payload)}::jsonb)`;
}
