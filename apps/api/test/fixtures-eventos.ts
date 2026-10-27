import { randomUUID } from 'node:crypto';
import { Rol } from '@entradas/db';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ahora, firmarHs256 } from './jwt-prueba';

export const SECRETO = 'secreto-de-prueba-de-al-menos-32-bytes!!';
const DOMINIO = '@eventos.test.local';
const DIA = 24 * 60 * 60 * 1000;

// Fechas relativas a hoy: con fechas fijas, los tests se rompen el día en que
// quedan en el pasado.
export const enDias = (dias: number) => new Date(Date.now() + dias * DIA);

// El mismo instante con el offset de Bolivia (-04:00), como lo mandaría la web.
export const enHoraBolivia = (fecha: Date) =>
  new Date(fecha.getTime() - 4 * 3600 * 1000).toISOString().replace('Z', '-04:00');

export const tokenDe = (usuario: { id: string; rol: Rol }) =>
  firmarHs256({ sub: usuario.id, rol: usuario.rol, iat: ahora(), exp: ahora() + 3600 }, SECRETO);

// Datos propios de cada corrida: dos ciudades con slug único (no se mezclan con
// la semilla), un recinto en cada una y un usuario por rol.
export async function crearFixtures(prisma: PrismaService) {
  const sufijo = randomUUID().slice(0, 8);
  // CB puede venir de la semilla: upsert con los mismos datos y nunca se borra.
  const cb = await prisma.departamento.upsert({
    where: { codigo: 'CB' },
    update: {},
    create: { codigo: 'CB', nombre: 'Cochabamba' },
  });
  const ciudad = (nombre: string) =>
    prisma.ciudad.create({ data: { departamentoId: cb.id, nombre, slug: `e2e-${nombre.toLowerCase()}-${sufijo}` } });
  const ciudadA = await ciudad('Quillacollo');
  const ciudadB = await ciudad('Sacaba');
  const recinto = (ciudadId: number, nombre: string) =>
    prisma.recinto.create({ data: { ciudadId, nombre, direccion: 'Av. de prueba' } });
  const recintoA = await recinto(ciudadA.id, 'Coliseo A');
  const recintoB = await recinto(ciudadB.id, 'Coliseo B');

  const usuario = (nombre: string, rol: Rol) =>
    prisma.usuario.create({
      // El hash no se usa: los tokens se firman a mano.
      data: { email: `${nombre}-${sufijo}${DOMINIO}`, passwordHash: 'no-se-usa', nombre, rol },
      select: { id: true, rol: true },
    });
  const usuarios = {
    organizadorA: await usuario('org-a', Rol.ORGANIZADOR),
    organizadorB: await usuario('org-b', Rol.ORGANIZADOR),
    admin: await usuario('admin', Rol.ADMIN),
    comprador: await usuario('comprador', Rol.COMPRADOR),
    validador: await usuario('validador', Rol.VALIDADOR),
  };

  // N compradores distintos de una vez (C-01 necesita 50: el límite por usuario
  // y RN-04 no deben intervenir). Mismo dominio y sufijo: limpiar() los borra.
  const crearCompradores = async (n: number) => {
    const lote = randomUUID().slice(0, 8);
    const emails = Array.from({ length: n }, (_, i) => `comprador-${lote}-${i}-${sufijo}${DOMINIO}`);
    await prisma.usuario.createMany({
      data: emails.map((email, i) => ({ email, passwordHash: 'no-se-usa', nombre: `Comprador ${i}`, rol: Rol.COMPRADOR })),
    });
    return prisma.usuario.findMany({
      where: { email: { in: emails } },
      select: { id: true, rol: true },
      orderBy: { email: 'asc' },
    });
  };

  const limpiar = async () => {
    const recintos = [recintoA.id, recintoB.id];
    const eventos = { evento: { recintoId: { in: recintos } } };
    // Orden inverso a las FK (todas son RESTRICT). Los asientos apuntan a las
    // órdenes: se borran antes que ellas.
    await prisma.ordenItem.deleteMany({ where: { orden: eventos } });
    await prisma.asiento.deleteMany({ where: eventos });
    await prisma.orden.deleteMany({ where: eventos });
    await prisma.zona.deleteMany({ where: eventos });
    await prisma.evento.deleteMany({ where: { recintoId: { in: recintos } } });
    await prisma.recinto.deleteMany({ where: { id: { in: recintos } } });
    await prisma.ciudad.deleteMany({ where: { id: { in: [ciudadA.id, ciudadB.id] } } });
    await prisma.usuario.deleteMany({ where: { email: { endsWith: `${sufijo}${DOMINIO}` } } });
  };

  return { ciudadA, ciudadB, recintoA, recintoB, usuarios, crearCompradores, limpiar };
}

export type Fixtures = Awaited<ReturnType<typeof crearFixtures>>;
