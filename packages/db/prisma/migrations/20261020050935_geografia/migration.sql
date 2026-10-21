-- CreateTable
CREATE TABLE "departamentos" (
    "id" SMALLSERIAL NOT NULL,
    "codigo" CHAR(2) NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "departamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ciudades" (
    "id" SERIAL NOT NULL,
    "departamento_id" SMALLINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "ciudades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recintos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ciudad_id" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,

    CONSTRAINT "recintos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departamentos_codigo_key" ON "departamentos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "departamentos_nombre_key" ON "departamentos"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "ciudades_slug_key" ON "ciudades"("slug");

-- CreateIndex
CREATE INDEX "recintos_ciudad_id_idx" ON "recintos"("ciudad_id");

-- AddForeignKey
ALTER TABLE "ciudades" ADD CONSTRAINT "ciudades_departamento_id_fkey" FOREIGN KEY ("departamento_id") REFERENCES "departamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recintos" ADD CONSTRAINT "recintos_ciudad_id_fkey" FOREIGN KEY ("ciudad_id") REFERENCES "ciudades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
