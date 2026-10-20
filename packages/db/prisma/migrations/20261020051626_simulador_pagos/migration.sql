-- CreateTable
CREATE TABLE "simulador_pagos" (
    "referencia" TEXT NOT NULL,
    "orden_id" UUID NOT NULL,
    "monto_centavos" BIGINT NOT NULL,
    "moneda" CHAR(3) NOT NULL DEFAULT 'BOB',
    "modo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "enviar_en" TIMESTAMPTZ(6),
    "intentos_entrega" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "simulador_pagos_pkey" PRIMARY KEY ("referencia")
);

-- SQL manual (Prisma no lo expresa): modos, estados, monto no negativo y moneda
-- BOB del simulador (doc 09 §2, ADR-0015).
ALTER TABLE "simulador_pagos" ADD CONSTRAINT "simulador_pagos_modo_chk"
    CHECK ("modo" IN ('OK', 'RECHAZO', 'DUPLICAR', 'DEMORA', 'DESORDEN', 'MONTO_ERRONEO'));
ALTER TABLE "simulador_pagos" ADD CONSTRAINT "simulador_pagos_estado_chk"
    CHECK ("estado" IN ('PENDIENTE', 'PAGADO', 'RECHAZADO'));
ALTER TABLE "simulador_pagos" ADD CONSTRAINT "simulador_pagos_monto_centavos_chk"
    CHECK ("monto_centavos" >= 0);
ALTER TABLE "simulador_pagos" ADD CONSTRAINT "simulador_pagos_moneda_chk"
    CHECK ("moneda" = 'BOB');
