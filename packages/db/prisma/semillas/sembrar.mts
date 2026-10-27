import { argon2id, hash } from 'argon2';
import type { PrismaClient } from '../../dist/index.js';
import { CIUDADES, DEPARTAMENTOS, RECINTOS, USUARIOS } from './datos.mts';

// Los mismos parámetros que apps/api/src/auth/hash.service.ts: si cambian allá,
// cambiarlos aquí. El login verifica igual (los parámetros van dentro del hash).
const OPCIONES = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD = 8; // igual que registro.dto.ts

// Idempotente: todo es upsert sobre claves únicas (codigo, slug, email, id del recinto), así
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

    const idCiudad = new Map<string, number>();
    for (const { departamento, nombre, slug } of CIUDADES) {
      const departamentoId = idDepartamento.get(departamento)!;
      const { id } = await tx.ciudad.upsert({
        where: { slug },
        update: { nombre, departamentoId },
        create: { nombre, slug, departamentoId },
      });
      idCiudad.set(slug, id);
    }

    for (const { id, ciudad, nombre, direccion } of RECINTOS) {
      const ciudadId = idCiudad.get(ciudad)!;
      await tx.recinto.upsert({
        where: { id },
        update: { nombre, direccion, ciudadId },
        create: { id, nombre, direccion, ciudadId },
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

    return {
      departamentos: DEPARTAMENTOS.length,
      ciudades: CIUDADES.length,
      recintos: RECINTOS.length,
      usuarios: USUARIOS.length,
    };
  });
}
