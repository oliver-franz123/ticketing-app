import { argon2id, hash } from 'argon2';
import type { PrismaClient } from '../../dist/index.js';
import { CIUDADES, DEPARTAMENTOS, USUARIOS } from './datos.mts';

// Los mismos parámetros que apps/api/src/auth/hash.service.ts: si cambian allá,
// cambiarlos aquí. El login verifica igual (los parámetros van dentro del hash).
const OPCIONES = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD = 8; // igual que registro.dto.ts

// Idempotente: todo es upsert sobre claves únicas (codigo, slug, email), así
// que correrla dos veces deja las mismas filas con los mismos ids.
export async function sembrar(prisma: PrismaClient, password: string) {
  if (password.length < MIN_PASSWORD) {
    throw new Error(`SEED_PASSWORD debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }

  // Fuera de la transacción: argon2 tarda ~50 ms por hash y no toca la BD.
  const hashes = await Promise.all(USUARIOS.map(() => hash(password, OPCIONES)));

  return prisma.$transaction(async (tx) => {
    const idDepartamento = new Map<string, number>();
    for (const { codigo, nombre } of DEPARTAMENTOS) {
      const { id } = await tx.departamento.upsert({
        where: { codigo },
        update: { nombre },
        create: { codigo, nombre },
      });
      idDepartamento.set(codigo, id);
    }

    for (const { departamento, nombre, slug } of CIUDADES) {
      const departamentoId = idDepartamento.get(departamento)!;
      await tx.ciudad.upsert({
        where: { slug },
        update: { nombre, departamentoId },
        create: { nombre, slug, departamentoId },
      });
    }

    // update vacío: si el usuario ya existe, no se le pisa la contraseña ni el rol.
    for (const [i, usuario] of USUARIOS.entries()) {
      await tx.usuario.upsert({
        where: { email: usuario.email },
        update: {},
        create: { ...usuario, passwordHash: hashes[i] },
      });
    }

    return { departamentos: DEPARTAMENTOS.length, ciudades: CIUDADES.length, usuarios: USUARIOS.length };
  });
}
