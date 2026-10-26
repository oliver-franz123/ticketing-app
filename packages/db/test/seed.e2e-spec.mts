import path from 'node:path';
import { config } from 'dotenv';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, PrismaPg } from '../dist/index.js';
import { CIUDADES, DEPARTAMENTOS, USUARIOS } from '../prisma/semillas/datos.mts';
import { sembrar } from '../prisma/semillas/sembrar.mts';

// Contra el Postgres de docker compose (local) o el service de CI. No limpia al
// final: las filas son las mismas que dejaría `npm run seed`.
config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const foto = async () => ({
  departamentos: await prisma.departamento.findMany({
    where: { codigo: { in: DEPARTAMENTOS.map((d) => d.codigo) } },
    orderBy: { codigo: 'asc' },
  }),
  ciudades: await prisma.ciudad.findMany({
    where: { slug: { in: CIUDADES.map((c) => c.slug) } },
    orderBy: { slug: 'asc' },
  }),
  usuarios: await prisma.usuario.findMany({
    where: { email: { in: USUARIOS.map((u) => u.email) } },
    orderBy: { email: 'asc' },
  }),
});

describe('semillas (T7)', () => {
  afterAll(() => prisma.$disconnect());

  it('correr dos veces deja las mismas filas, con los mismos ids', async () => {
    await sembrar(prisma, 'primera-contraseña');
    const primera = await foto();

    // Otra contraseña a propósito: la segunda corrida no debe pisar el hash.
    await sembrar(prisma, 'segunda-contraseña');
    const segunda = await foto();

    expect(primera.departamentos).toHaveLength(9);
    expect(primera.ciudades).toHaveLength(7);
    expect(primera.usuarios.map((u) => u.rol).sort()).toEqual(['ADMIN', 'COMPRADOR', 'ORGANIZADOR', 'VALIDADOR']);
    expect(segunda).toEqual(primera);
  });

  it('las ciudades quedan en Cochabamba y los hashes con los parámetros de hash.service.ts', async () => {
    const { ciudades, usuarios } = await foto();
    const cb = await prisma.departamento.findFirstOrThrow({ where: { codigo: 'CB' } });

    expect(ciudades.every((c) => c.departamentoId === cb.id)).toBe(true);
    for (const { passwordHash } of usuarios) {
      expect(passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    }
  });

  it('rechaza una contraseña de menos de 8 caracteres', async () => {
    await expect(sembrar(prisma, 'corta')).rejects.toThrow('al menos 8');
  });
});
