-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): un solo pago EN_PROCESO por
-- orden. POST /ordenes/:id/pago llama al simulador sin retener una transacción
-- (el simulador vive en la misma API y necesita su propia conexión del pool) y
-- después inserta con ON CONFLICT DO NOTHING: si hubo un doble clic, gana uno.
CREATE UNIQUE INDEX "ux_pago_en_proceso_por_orden" ON "pagos"("orden_id") WHERE (estado = 'EN_PROCESO');
