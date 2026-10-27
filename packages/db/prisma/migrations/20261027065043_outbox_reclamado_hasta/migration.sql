-- AlterTable
-- Lease del Worker sobre la fila (ADR-0017): reclamar con SKIP LOCKED y procesar fuera de la transacción.
ALTER TABLE "outbox" ADD COLUMN     "reclamado_hasta" TIMESTAMPTZ(6);
