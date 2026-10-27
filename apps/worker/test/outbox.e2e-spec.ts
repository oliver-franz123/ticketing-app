import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { ProcesadorOutbox } from '../src/outbox/outbox.procesador';
import { OutboxRepositorio } from '../src/outbox/outbox.repositorio';
import { PrismaService } from '../src/prisma/prisma.service';
import { WorkerModule } from '../src/worker.module';
import {
  adjuntosDe,
  crearFixtures,
  emailsPara,
  esperarHasta,
  type Fixtures,
  insertarOutbox,
} from './fixtures';

// El Worker consume el outbox directamente (ADR-0017), contra Postgres y
// Mailpit reales. W-01 (la API vende con el Worker apagado) está en apps/api.
const { privateKey } = generateKeyPairSync('ed25519');
const CLAVE_PRIVADA = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

// Contexto Nest del Worker. intervaloMs '0' = sin tick automático: cada test
// procesa a mano con procesarLote() y sabe cuándo pasa cada cosa.
async function arrancarWorker(env: Record<string, string> = {}): Promise<INestApplicationContext> {
  const anterior = { ...process.env };
  Object.assign(process.env, { QR_SIGNING_PRIVATE_KEY: CLAVE_PRIVADA, OUTBOX_INTERVALO_MS: '0', ...env });
  try {
    const modulo = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    modulo.useLogger(false);
    return await modulo.init();
  } finally {
    process.env = anterior;
  }
}

const puertoCerrado = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe('Worker: outbox → QR + PDF + email', () => {
  let worker: INestApplicationContext;
  let prisma: PrismaService;
  let repo: OutboxRepositorio;
  let procesador: ProcesadorOutbox;
  let fx: Fixtures;
  // Filas sueltas (payload con un ordenId inventado) de los tests del reclamo.
  const sueltas: bigint[] = [];

  beforeAll(async () => {
    worker = await arrancarWorker();
    prisma = worker.get(PrismaService);
    repo = worker.get(OutboxRepositorio);
    procesador = worker.get(ProcesadorOutbox);
    fx = await crearFixtures(prisma);
  });

  afterEach(async () => {
    await prisma.$executeRaw`DELETE FROM outbox WHERE id = ANY(${sueltas.splice(0)}::bigint[])`;
  });

  afterAll(async () => {
    await fx?.limpiar();
    await worker?.close();
  });

  const fila = (id: bigint) => prisma.outbox.findUniqueOrThrow({ where: { id } });
  const envio = (ordenId: string) => prisma.envioEmail.findFirst({ where: { ordenId, tipo: 'ENTRADAS' } });
  const propias = <T extends { id: bigint }>(filas: T[], ids: bigint[]) => filas.filter((f) => ids.includes(f.id));

  const filasSueltas = async (n: number) => {
    const ids: bigint[] = [];
    for (let i = 0; i < n; i++) ids.push(await insertarOutbox(prisma, 'ENTRADAS_EMITIDAS', randomUUID()));
    sueltas.push(...ids);
    return ids;
  };

  // Lo que dejaría un Worker que murió a medias: el lease ya venció.
  const vencerLease = (id: bigint) =>
    prisma.$executeRaw`UPDATE outbox SET reclamado_hasta = now() - interval '1 second' WHERE id = ${id}`;

  describe('W-02: al arrancar el Worker procesa lo acumulado', () => {
    it('3 órdenes pagadas con el Worker apagado → al arrancar: 3 filas procesadas, 3 ENVIADO y 3 emails con su PDF en Mailpit', async () => {
      const ordenes = [await fx.crearOrden(), await fx.crearOrden({ asientos: 1 }), await fx.crearOrden({ asientos: 3 })];

      // Worker con su tick real, como en `npm run dev -w @entradas/worker`.
      const vivo = await arrancarWorker({ OUTBOX_INTERVALO_MS: '100' });
      try {
        await esperarHasta(async () => {
          const filas = await Promise.all(ordenes.map((o) => fila(o.outboxId)));
          return filas.every((f) => f.publicadoEn !== null);
        }, 10_000);
      } finally {
        await vivo.close();
      }

      for (const orden of ordenes) {
        expect(await fila(orden.outboxId)).toMatchObject({ reclamadoHasta: null, intentos: 1 });
        expect(await envio(orden.ordenId)).toMatchObject({ estado: 'ENVIADO', intentos: 1 });
        const emails = await emailsPara(orden.email);
        expect(emails).toHaveLength(1);
        const adjuntos = await adjuntosDe(emails[0].ID);
        expect(adjuntos).toHaveLength(1);
        expect(adjuntos[0].ContentType).toBe('application/pdf');
        expect(adjuntos[0].bytes.subarray(0, 5).toString()).toBe('%PDF-');
      }
      // Espera hasta 10 s al tick del Worker: más que los 5 s por defecto.
    }, 20_000);
  });

  describe('reclamar: FOR UPDATE SKIP LOCKED + lease', () => {
    it('dos Workers a la vez → conjuntos disjuntos que juntos cubren las 10 filas', async () => {
      const ids = await filasSueltas(10);
      const [a, b] = await Promise.all([repo.reclamar(1000), repo.reclamar(1000)]);
      const idsA = propias(a, ids).map((f) => f.id);
      const idsB = propias(b, ids).map((f) => f.id);
      expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
      expect([...idsA, ...idsB].sort()).toEqual([...ids].sort());
    });

    it('filas bloqueadas por otro Worker (sin commit) → se saltan sin esperar y se toman las demás', async () => {
      const ids = await filasSueltas(10);
      const bloqueadas = ids.slice(0, 5);
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM outbox WHERE id = ANY(${bloqueadas}::bigint[]) FOR UPDATE`;
          // Sin SKIP LOCKED, reclamar() se queda esperando estos locks.
          const reclamadas = await Promise.race([
            repo.reclamar(1000),
            new Promise<never>((_, rechazar) => setTimeout(() => rechazar(new Error('reclamar() esperó los locks')), 3000)),
          ]);
          expect(propias(reclamadas, ids).map((f) => f.id).sort()).toEqual(ids.slice(5).sort());
        },
        { timeout: 10_000 },
      );
    });

    it('lease vigente o fila ya procesada → no se reclama; lease vencido → sí, con intentos + 1', async () => {
      const [vigente, vencida, procesada, nueva] = await filasSueltas(4);
      await prisma.$executeRaw`UPDATE outbox SET reclamado_hasta = now() + interval '60 seconds', intentos = 1 WHERE id = ${vigente}`;
      await prisma.$executeRaw`UPDATE outbox SET reclamado_hasta = now() - interval '1 second', intentos = 1 WHERE id = ${vencida}`;
      await prisma.$executeRaw`UPDATE outbox SET publicado_en = now() WHERE id = ${procesada}`;

      const reclamadas = propias(await repo.reclamar(1000), [vigente, vencida, procesada, nueva]);
      expect(reclamadas.map((f) => f.id).sort()).toEqual([vencida, nueva].sort());
      expect(reclamadas.find((f) => f.id === vencida)).toMatchObject({ tipo: 'ENTRADAS_EMITIDAS', intentos: 2 });

      // El lease nuevo es de ~120 s, medido con el reloj de Postgres.
      const [{ s }] = await prisma.$queryRaw<{ s: number }[]>`
        SELECT extract(epoch FROM reclamado_hasta - now())::float AS s FROM outbox WHERE id = ${nueva}`;
      expect(s).toBeGreaterThan(110);
      expect(s).toBeLessThanOrEqual(120);
      // Recién reclamada: el siguiente reclamo no la vuelve a tomar.
      expect(propias(await repo.reclamar(1000), [nueva])).toEqual([]);
    });

    it('marcarProcesado: fija publicado_en y suelta el lease; una segunda vez no pisa la fecha', async () => {
      const [id] = await filasSueltas(1);
      await repo.reclamar(1000);
      await repo.marcarProcesado(id);
      const primera = await fila(id);
      expect(primera.publicadoEn).not.toBeNull();
      expect(primera.reclamadoHasta).toBeNull();
      await repo.marcarProcesado(id);
      expect((await fila(id)).publicadoEn).toEqual(primera.publicadoEn);
    });
  });

  describe('idempotencia: un email por orden', () => {
    it('el Worker cae después de enviar y antes de marcar la fila → al reintentar, ningún email nuevo', async () => {
      const orden = await fx.crearOrden();
      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([
        { id: orden.outboxId, tipo: 'ENTRADAS_EMITIDAS', ok: true },
      ]);
      // La fila vuelve a quedar pendiente, como si marcarProcesado no hubiera llegado a correr.
      await prisma.$executeRaw`UPDATE outbox SET publicado_en = NULL WHERE id = ${orden.outboxId}`;
      await vencerLease(orden.outboxId);

      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([
        { id: orden.outboxId, tipo: 'ENTRADAS_EMITIDAS', ok: true },
      ]);
      expect(await emailsPara(orden.email)).toHaveLength(1);
      expect(await envio(orden.ordenId)).toMatchObject({ estado: 'ENVIADO', intentos: 1 });
      expect((await fila(orden.outboxId)).publicadoEn).not.toBeNull();
    });

    it('una segunda fila ENTRADAS_EMITIDAS de una orden ya enviada → se marca procesada sin enviar', async () => {
      const orden = await fx.crearOrden();
      await procesador.procesarLote();
      const otra = await insertarOutbox(prisma, 'ENTRADAS_EMITIDAS', orden.ordenId);

      expect(propias(await procesador.procesarLote(), [otra])).toEqual([{ id: otra, tipo: 'ENTRADAS_EMITIDAS', ok: true }]);
      expect(await emailsPara(orden.email)).toHaveLength(1);
      expect((await fila(otra)).publicadoEn).not.toBeNull();
    });

    it('email FALLIDO (error permanente, doc 05 §7) → no se reintenta: la fila se marca procesada y no sale nada', async () => {
      const orden = await fx.crearOrden();
      await prisma.envioEmail.create({ data: { ordenId: orden.ordenId, tipo: 'ENTRADAS', estado: 'FALLIDO', intentos: 1 } });

      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([
        { id: orden.outboxId, tipo: 'ENTRADAS_EMITIDAS', ok: true },
      ]);
      expect(await emailsPara(orden.email)).toHaveLength(0);
      expect(await envio(orden.ordenId)).toMatchObject({ estado: 'FALLIDO', intentos: 1 });
      expect((await fila(orden.outboxId)).publicadoEn).not.toBeNull();
    });
  });

  describe('tolerancia a fallos', () => {
    it('SMTP caído → la fila sigue pendiente y el email PENDIENTE; al volver el SMTP y vencer el lease → 1 email', async () => {
      const orden = await fx.crearOrden();
      const sinSmtp = await arrancarWorker({ SMTP_URL: `smtp://127.0.0.1:${await puertoCerrado()}` });
      try {
        expect(propias(await sinSmtp.get(ProcesadorOutbox).procesarLote(), [orden.outboxId])).toEqual([
          { id: orden.outboxId, tipo: 'ENTRADAS_EMITIDAS', ok: false },
        ]);
      } finally {
        await sinSmtp.close();
      }
      expect(await fila(orden.outboxId)).toMatchObject({ publicadoEn: null, intentos: 1 });
      expect(await envio(orden.ordenId)).toMatchObject({ estado: 'PENDIENTE', intentos: 1 });

      // Lease vigente: nadie la toma todavía.
      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([]);
      await vencerLease(orden.outboxId);
      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([
        { id: orden.outboxId, tipo: 'ENTRADAS_EMITIDAS', ok: true },
      ]);
      expect(await emailsPara(orden.email)).toHaveLength(1);
      expect(await envio(orden.ordenId)).toMatchObject({ estado: 'ENVIADO', intentos: 2 });
      expect(await fila(orden.outboxId)).toMatchObject({ intentos: 2 });
    });

    it('REEMBOLSO_REQUERIDO → solo se registra: fila procesada, sin email ni envios_email', async () => {
      const orden = await fx.crearOrden({ estado: 'REEMBOLSO_REQUERIDO' });
      expect(propias(await procesador.procesarLote(), [orden.outboxId])).toEqual([
        { id: orden.outboxId, tipo: 'REEMBOLSO_REQUERIDO', ok: true },
      ]);
      expect((await fila(orden.outboxId)).publicadoEn).not.toBeNull();
      expect(await emailsPara(orden.email)).toHaveLength(0);
      expect(await prisma.envioEmail.count({ where: { ordenId: orden.ordenId } })).toBe(0);
    });

    it('sin QR_SIGNING_PRIVATE_KEY el Worker no arranca', async () => {
      // Vacía y no borrada: si no está en process.env, ConfigModule la tomaría del .env local.
      await expect(arrancarWorker({ QR_SIGNING_PRIVATE_KEY: '' })).rejects.toThrow(/QR_SIGNING_PRIVATE_KEY/);
    });
  });
});
