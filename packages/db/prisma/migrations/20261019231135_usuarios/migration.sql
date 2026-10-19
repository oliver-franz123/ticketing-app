-- SQL manual (Prisma no lo expresa): extensión citext. Prisma pone el tipo
-- (@db.Citext) pero no crea la extensión. Tiene que ir antes del CREATE TABLE.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "rol" AS ENUM ('COMPRADOR', 'ORGANIZADOR', 'VALIDADOR', 'ADMIN');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "rol" "rol" NOT NULL DEFAULT 'COMPRADOR',
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- SQL manual (Prisma no lo expresa): teléfono boliviano E.164 opcional (doc 09).
-- Prisma no introspecta los CHECK, así que no los borra ni genera drift.
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_telefono_chk"
    CHECK ("telefono" IS NULL OR "telefono" ~ '^\+591[0-9]{8}$');
