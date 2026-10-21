-- CreateTable
CREATE TABLE "ordenes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE_PAGO',
    "total_centavos" BIGINT NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'BOB',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "extension_usada" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" UUID NOT NULL,
    "nit" TEXT,
    "razon_social" TEXT,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asientos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evento_id" UUID NOT NULL,
    "zona_id" UUID NOT NULL,
    "fila" TEXT NOT NULL,
    "columna" INTEGER NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'LIBRE',
    "orden_id" UUID,
    "expires_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "asientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orden_items" (
    "orden_id" UUID NOT NULL,
    "asiento_id" UUID NOT NULL,
    "precio_centavos" BIGINT NOT NULL,

    CONSTRAINT "orden_items_pkey" PRIMARY KEY ("orden_id","asiento_id")
);

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): job que marca órdenes EXPIRADAS, solo las pendientes (doc 09 §5).
CREATE INDEX "ix_ordenes_pendientes_expires" ON "ordenes"("estado", "expires_at") WHERE (estado = 'PENDIENTE_PAGO');

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_usuario_id_idempotency_key_key" ON "ordenes"("usuario_id", "idempotency_key");

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): RN-04, una orden PENDIENTE_PAGO por usuario y evento (doc 09 §4).
CREATE UNIQUE INDEX "ux_orden_pendiente_por_evento" ON "ordenes"("usuario_id", "evento_id") WHERE (estado = 'PENDIENTE_PAGO');

-- CreateIndex
CREATE INDEX "asientos_evento_id_estado_idx" ON "asientos"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "asientos_orden_id_idx" ON "asientos"("orden_id");

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): job liberar-vencidas, solo lo RESERVADO (doc 09 §5).
CREATE INDEX "ix_asientos_reservados_expires" ON "asientos"("expires_at") WHERE (estado = 'RESERVADO');

-- CreateIndex
CREATE UNIQUE INDEX "asientos_evento_id_fila_columna_key" ON "asientos"("evento_id", "fila", "columna");

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zonas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_items" ADD CONSTRAINT "orden_items_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_items" ADD CONSTRAINT "orden_items_asiento_id_fkey" FOREIGN KEY ("asiento_id") REFERENCES "asientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL manual (Prisma no lo expresa): estados permitidos, monto no negativo y
-- moneda BOB de la orden (doc 09 §4). No hay FALLIDA (doc 04 §1).
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_estado_chk"
    CHECK ("estado" IN ('PENDIENTE_PAGO', 'PAGADA', 'EXPIRADA', 'CANCELADA',
                        'REEMBOLSO_REQUERIDO', 'REVISION_MANUAL'));
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_total_centavos_chk"
    CHECK ("total_centavos" >= 0);
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_moneda_chk"
    CHECK ("moneda" = 'BOB');

-- SQL manual (Prisma no lo expresa): estados permitidos del asiento (doc 04 §1).
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_estado_chk"
    CHECK ("estado" IN ('LIBRE', 'RESERVADO', 'VENDIDO', 'NO_DISPONIBLE'));

-- SQL manual (Prisma no lo expresa): coherencia entre estado, orden y
-- vencimiento, copiada de doc 04 §4.2. Segunda red de seguridad: aunque el
-- código tuviera un bug, no puede quedar un RESERVADO sin dueño ni sin vencimiento.
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_coherencia_chk"
    CHECK (
         ("estado" = 'RESERVADO'                AND "orden_id" IS NOT NULL AND "expires_at" IS NOT NULL)
      OR ("estado" = 'VENDIDO'                  AND "orden_id" IS NOT NULL AND "expires_at" IS NULL)
      OR ("estado" IN ('LIBRE', 'NO_DISPONIBLE') AND "orden_id" IS NULL     AND "expires_at" IS NULL)
    );

-- SQL manual (Prisma no lo expresa): precio congelado no negativo (doc 09 §4).
ALTER TABLE "orden_items" ADD CONSTRAINT "orden_items_precio_centavos_chk"
    CHECK ("precio_centavos" >= 0);
