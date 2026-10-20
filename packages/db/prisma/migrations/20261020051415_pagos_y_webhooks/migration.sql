-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orden_id" UUID NOT NULL,
    "proveedor" TEXT NOT NULL,
    "referencia_externa" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EN_PROCESO',
    "monto_centavos" BIGINT NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'BOB',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_eventos" (
    "id" BIGSERIAL NOT NULL,
    "proveedor" TEXT NOT NULL,
    "evento_externo_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "recibido_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_sha256" TEXT NOT NULL,

    CONSTRAINT "webhook_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): reconciliación de pagos EN_PROCESO por proveedor (doc 09 §5).
CREATE INDEX "ix_pagos_en_proceso" ON "pagos"("proveedor", "creado_en") WHERE (estado = 'EN_PROCESO');

-- CreateIndex
CREATE UNIQUE INDEX "pagos_proveedor_referencia_externa_key" ON "pagos"("proveedor", "referencia_externa");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_eventos_proveedor_evento_externo_id_key" ON "webhook_eventos"("proveedor", "evento_externo_id");

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL manual (Prisma no lo expresa): estados, proveedores, monto no negativo y
-- moneda BOB del pago (doc 09 §4, ADR-0015).
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_estado_chk"
    CHECK ("estado" IN ('EN_PROCESO', 'CONFIRMADO', 'FALLIDO'));
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_proveedor_chk"
    CHECK ("proveedor" IN ('simulador', 'stripe', 'qr'));
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_monto_centavos_chk"
    CHECK ("monto_centavos" >= 0);
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_moneda_chk"
    CHECK ("moneda" = 'BOB');

-- SQL manual (Prisma no lo expresa): trigger de pagos.actualizado_en.
-- @updatedAt solo lo pone el cliente Prisma, y los UPDATE de pagos son SQL
-- explícito (ADR-0013). now() es la hora de inicio de la transacción.
-- Prisma no introspecta funciones ni triggers, así que no generan drift.
CREATE FUNCTION "set_actualizado_en"() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    NEW."actualizado_en" := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER "pagos_set_actualizado_en"
    BEFORE UPDATE ON "pagos"
    FOR EACH ROW EXECUTE FUNCTION "set_actualizado_en"();

-- SQL manual (Prisma no lo expresa): proveedores permitidos del webhook (ADR-0015).
ALTER TABLE "webhook_eventos" ADD CONSTRAINT "webhook_eventos_proveedor_chk"
    CHECK ("proveedor" IN ('simulador', 'stripe', 'qr'));
