-- AlterTable
ALTER TABLE "simulador_pagos" ADD COLUMN     "veces" INTEGER NOT NULL DEFAULT 1;

-- SQL manual (Prisma no lo expresa): DUPLICAR envía entre 2 y 10 copias; el
-- resto de los modos, 1. El tope evita que la demo se dispare a sí misma con
-- cientos de webhooks (ADR-0015).
ALTER TABLE "simulador_pagos" ADD CONSTRAINT "simulador_pagos_veces_chk"
    CHECK ("veces" BETWEEN 1 AND 10);
