-- CreateTable
CREATE TABLE "entradas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orden_id" UUID NOT NULL,
    "asiento_id" UUID NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'EMITIDA',
    "emitida_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usada_en" TIMESTAMPTZ(6),
    "usada_por" UUID,

    CONSTRAINT "entradas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validaciones" (
    "id" BIGSERIAL NOT NULL,
    "entrada_id" UUID,
    "validador_id" UUID NOT NULL,
    "resultado" TEXT NOT NULL,
    "en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entradas_orden_id_idx" ON "entradas"("orden_id");

-- CreateIndex
-- Índice parcial (preview partialIndexes, ADR-0016): RN-01, una entrada válida por asiento (doc 04 §4.2).
CREATE UNIQUE INDEX "ux_entrada_valida_por_asiento" ON "entradas"("asiento_id") WHERE (estado = ANY (ARRAY['EMITIDA'::text, 'USADA'::text]));

-- AddForeignKey
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_asiento_id_fkey" FOREIGN KEY ("asiento_id") REFERENCES "asientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_usada_por_fkey" FOREIGN KEY ("usada_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validaciones" ADD CONSTRAINT "validaciones_entrada_id_fkey" FOREIGN KEY ("entrada_id") REFERENCES "entradas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validaciones" ADD CONSTRAINT "validaciones_validador_id_fkey" FOREIGN KEY ("validador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL manual (Prisma no lo expresa): estados permitidos de la entrada (doc 09 §2).
ALTER TABLE "entradas" ADD CONSTRAINT "entradas_estado_chk"
    CHECK ("estado" IN ('EMITIDA', 'USADA', 'ANULADA'));

-- SQL manual (Prisma no lo expresa): resultados permitidos de la validación, y
-- entrada_id solo puede faltar en un INVALIDA (QR que no corresponde a ninguna entrada).
ALTER TABLE "validaciones" ADD CONSTRAINT "validaciones_resultado_chk"
    CHECK ("resultado" IN ('VALIDA', 'YA_USADA', 'INVALIDA', 'OTRO_EVENTO'));
ALTER TABLE "validaciones" ADD CONSTRAINT "validaciones_entrada_id_chk"
    CHECK ("entrada_id" IS NOT NULL OR "resultado" = 'INVALIDA');
