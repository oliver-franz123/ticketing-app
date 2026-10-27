import { randomUUID } from 'node:crypto';
import { Rol } from '@entradas/db';
import type { PrismaService } from '../src/prisma/prisma.service';

const DOMINIO = '@worker.test.local';

// El estado que deja la transacción del webhook (pagos.service): orden PAGADA,
// asientos VENDIDO, entradas EMITIDA y la fila del outbox. Se arma con Prisma
// porque el Worker no tiene la API: W-01 (apps/api) prueba que la API lo deja así.
export async function crearFixtures(prisma: PrismaService) {
  const sufijo = randomUUID().slice(0, 8);
  const cb = await prisma.departamento.upsert({
    where: { codigo: 'CB' },
    update: {},
    create: { codigo: 'CB', nombre: 'Cochabamba' },
  });
  const ciudad = await prisma.ciudad.create({
    data: { departamentoId: cb.id, nombre: 'Tiquipaya', slug: `e2e-worker-${sufijo}` },
  });
  const recinto = await prisma.recinto.create({
    data: { ciudadId: ciudad.id, nombre: 'Coliseo Worker', direccion: 'Av. de prueba' },
  });
  const organizador = await prisma.usuario.create({
    data: { email: `org-${sufijo}${DOMINIO}`, passwordHash: 'no-se-usa', nombre: 'Org', rol: Rol.ORGANIZADOR },
  });
  const evento = await prisma.evento.create({
    data: {
      organizadorId: organizador.id,
      recintoId: recinto.id,
      titulo: `Concierto ${sufijo}`,
      inicio: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      ventaInicio: new Date(Date.now() - 24 * 3600 * 1000),
      estado: 'PUBLICADO',
    },
  });
  const zona = await prisma.zona.create({ data: { eventoId: evento.id, nombre: 'Platea', precioCentavos: 10000n } });

  let columna = 0;
  let compradores = 0;

  // Una orden con `asientos` entradas y su fila del outbox. estado
  // REEMBOLSO_REQUERIDO: sin asientos vendidos ni entradas, como deja P-04.
  const crearOrden = async ({ asientos = 2, estado = 'PAGADA' } = {}) => {
    const email = `comprador-${compradores++}-${sufijo}${DOMINIO}`;
    const comprador = await prisma.usuario.create({
      data: { email, passwordHash: 'no-se-usa', nombre: 'Ana Quispe', rol: Rol.COMPRADOR },
    });
    const orden = await prisma.orden.create({
      data: {
        usuarioId: comprador.id,
        eventoId: evento.id,
        estado,
        totalCentavos: BigInt(asientos * 10000),
        expiresAt: new Date(),
        idempotencyKey: randomUUID(),
      },
    });
    if (estado === 'PAGADA') {
      for (let i = 0; i < asientos; i++) {
        const asiento = await prisma.asiento.create({
          data: { eventoId: evento.id, zonaId: zona.id, fila: 'A', columna: ++columna, estado: 'VENDIDO', ordenId: orden.id },
        });
        await prisma.entrada.create({ data: { ordenId: orden.id, asientoId: asiento.id } });
      }
    }
    const tipo = estado === 'PAGADA' ? 'ENTRADAS_EMITIDAS' : 'REEMBOLSO_REQUERIDO';
    const outboxId = await insertarOutbox(prisma, tipo, orden.id);
    return { ordenId: orden.id, email, outboxId };
  };

  const limpiar = async () => {
    const ordenes = (await prisma.orden.findMany({ where: { eventoId: evento.id }, select: { id: true } })).map(
      (o) => o.id,
    );
    await prisma.envioEmail.deleteMany({ where: { ordenId: { in: ordenes } } });
    await prisma.entrada.deleteMany({ where: { ordenId: { in: ordenes } } });
    await prisma.$executeRaw`DELETE FROM outbox WHERE payload->>'ordenId' = ANY(${ordenes}::text[])`;
    await prisma.asiento.deleteMany({ where: { eventoId: evento.id } });
    await prisma.orden.deleteMany({ where: { eventoId: evento.id } });
    await prisma.zona.deleteMany({ where: { eventoId: evento.id } });
    await prisma.evento.delete({ where: { id: evento.id } });
    await prisma.recinto.delete({ where: { id: recinto.id } });
    await prisma.ciudad.delete({ where: { id: ciudad.id } });
    await prisma.usuario.deleteMany({ where: { email: { endsWith: `${sufijo}${DOMINIO}` } } });
  };

  return { evento, crearOrden, limpiar };
}

export type Fixtures = Awaited<ReturnType<typeof crearFixtures>>;

// Igual que registrarEnOutbox de la API. Devuelve el id para seguir la fila.
export async function insertarOutbox(prisma: PrismaService, tipo: string, ordenId: string): Promise<bigint> {
  const [{ id }] = await prisma.$queryRaw<{ id: bigint }[]>`
    INSERT INTO outbox (tipo, payload) VALUES (${tipo}, ${JSON.stringify({ ordenId })}::jsonb) RETURNING id`;
  return id;
}

// Mailpit (doc 07 §8): se consulta por su API HTTP. Cada test usa
// destinatarios únicos, así que no hace falta vaciar el buzón.
export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface ResumenMensaje {
  ID: string;
}
interface Adjunto {
  PartID: string;
  FileName: string;
  ContentType: string;
}

export async function emailsPara(email: string): Promise<ResumenMensaje[]> {
  const r = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  if (!r.ok) throw new Error(`Mailpit respondió ${r.status}: ¿está levantado? (docker compose up -d mailpit)`);
  return ((await r.json()) as { messages: ResumenMensaje[] }).messages;
}

export async function adjuntosDe(mensajeId: string): Promise<(Adjunto & { bytes: Buffer })[]> {
  const r = await fetch(`${MAILPIT_URL}/api/v1/message/${mensajeId}`);
  const { Attachments } = (await r.json()) as { Attachments: Adjunto[] };
  return Promise.all(
    Attachments.map(async (a) => {
      const parte = await fetch(`${MAILPIT_URL}/api/v1/message/${mensajeId}/part/${a.PartID}`);
      return { ...a, bytes: Buffer.from(await parte.arrayBuffer()) };
    }),
  );
}

// Espera activa con tope: para W-02, donde el Worker procesa en su propio tick.
export async function esperarHasta(condicion: () => Promise<boolean>, ms: number): Promise<void> {
  const limite = Date.now() + ms;
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error(`la condición no se cumplió en ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
