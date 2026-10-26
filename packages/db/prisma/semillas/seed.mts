// npm run seed [-- --permitir-remota]   (desde la raíz; doc 11, T7)
import path from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, PrismaPg } from '../../dist/index.js';
import { verificarDestino } from './proteccion.mts';
import { MIN_PASSWORD, sembrar } from './sembrar.mts';

// El .env único de la raíz, como prisma.config.ts. No pisa variables ya exportadas.
config({ path: path.resolve(import.meta.dirname, '../../../../.env'), quiet: true });

function salir(mensaje: string): never {
  console.error(`✗ ${mensaje}`);
  process.exit(1);
}

const destino = verificarDestino(process.env, process.argv.slice(2));
if (!destino.permitido) salir(destino.motivo);
if (destino.advertencia) console.warn(`⚠ ${destino.advertencia}`);

const password = process.env.SEED_PASSWORD ?? '';
if (password.length < MIN_PASSWORD) {
  salir(`Define SEED_PASSWORD en el .env (al menos ${MIN_PASSWORD} caracteres). Ver .env.example.`);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
try {
  const total = await sembrar(prisma, password);
  console.log(
    `✓ Semillas: ${total.departamentos} departamentos, ${total.ciudades} ciudades y ${total.usuarios} usuarios.`,
  );
} catch (error) {
  // exitCode y no salir(): el finally tiene que cerrar la conexión.
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
