// Configuración del CLI de Prisma (migraciones y generate). El .env es único
// en la raíz del repo: lo comparten api, worker y docker compose.
import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // El CLI usa la conexión directa: en Supabase, el pooler en modo sesión (doc 07).
  // DATABASE_URL (modo transacción) es solo para el runtime.
  datasource: { url: env('DIRECT_URL') },
});
