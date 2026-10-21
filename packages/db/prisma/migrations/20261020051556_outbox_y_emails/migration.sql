-- CreateTable
CREATE TABLE "outbox" (
    "id" BIGSERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicado_en" TIMESTAMPTZ(6),
    "intentos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "envios_email" (
    "orden_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "proveedor_msg_id" TEXT,
    "intentos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "envios_email_pkey" PRIMARY KEY ("orden_id","tipo")
);

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): relay del outbox, solo lo no publicado (doc 09 §5).
CREATE INDEX "ix_outbox_pendientes" ON "outbox"("id") WHERE (publicado_en IS NULL);

-- AddForeignKey
ALTER TABLE "envios_email" ADD CONSTRAINT "envios_email_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL manual (Prisma no lo expresa): tipos permitidos del outbox (doc 09 §2).
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tipo_chk"
    CHECK ("tipo" IN ('ENTRADAS_EMITIDAS', 'REEMBOLSO_REQUERIDO'));

-- SQL manual (Prisma no lo expresa): tipos y estados permitidos del email (doc 09 §2).
ALTER TABLE "envios_email" ADD CONSTRAINT "envios_email_tipo_chk"
    CHECK ("tipo" IN ('ENTRADAS', 'REEMBOLSO'));
ALTER TABLE "envios_email" ADD CONSTRAINT "envios_email_estado_chk"
    CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO'));
