-- CreateTable
CREATE TABLE "eventos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizador_id" UUID NOT NULL,
    "recinto_id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "venta_inicio" TIMESTAMPTZ(6) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "mapa_version" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zonas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evento_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio_centavos" BIGINT NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'BOB',

    CONSTRAINT "zonas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_validadores" (
    "evento_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,

    CONSTRAINT "evento_validadores_pkey" PRIMARY KEY ("evento_id","usuario_id")
);

-- CreateIndex
CREATE INDEX "eventos_estado_inicio_idx" ON "eventos"("estado", "inicio");

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_organizador_id_fkey" FOREIGN KEY ("organizador_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_recinto_id_fkey" FOREIGN KEY ("recinto_id") REFERENCES "recintos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_validadores" ADD CONSTRAINT "evento_validadores_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_validadores" ADD CONSTRAINT "evento_validadores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL manual (Prisma no lo expresa): estados permitidos del evento (doc 09 §1).
-- Prisma no introspecta los CHECK, así que no generan drift.
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_estado_chk"
    CHECK ("estado" IN ('BORRADOR', 'PUBLICADO', 'CANCELADO', 'FINALIZADO'));

-- SQL manual (Prisma no lo expresa): montos no negativos y moneda BOB (doc 09 §4).
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_precio_centavos_chk"
    CHECK ("precio_centavos" >= 0);
ALTER TABLE "zonas" ADD CONSTRAINT "zonas_moneda_chk"
    CHECK ("moneda" = 'BOB');
