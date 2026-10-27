import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Rol } from '@entradas/db';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { firmaSimulador, SECRETO_SIMULADOR } from './firma-simulador-prueba';
import { crearFixtures, enDias, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';

// Webhook de pago idempotente y re-captura (doc 04 §4.3, doc 05 §4, ADR-0004)
// contra el Postgres real. El pago EN_PROCESO se inserta con Prisma y el test
// firma el webhook a mano: así se prueba solo la confirmación, sin el simulador.
type Usuario = { id: string; rol: Rol };
type OrdenCreada = { ordenId: string; totalCentavos: number };

const PRECIO = 15050;

describe('Pagos: webhook del simulador', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    process.env.SIMULADOR_WEBHOOK_SECRET = SECRETO_SIMULADOR;
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // rawBody: la firma se verifica sobre los bytes exactos, no sobre el JSON re-serializado.
    app = configurarApp(modulo.createNestApplication({ rawBody: true }));
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    fx = await crearFixtures(prisma);
  });

  afterAll(async () => {
    await fx?.limpiar();
    await app.close();
  });

  // Evento PUBLICADO con la venta abierta, creado y publicado por la API (como en ordenes.e2e-spec).
  const eventoALaVenta = async () => {
    const auth = `Bearer ${tokenDe(fx.usuarios.organizadorA)}`;
    const res = await request(url)
      .post('/eventos')
      .set('Authorization', auth)
      .send({
        titulo: `Pagos ${randomUUID().slice(0, 8)}`,
        recintoId: fx.recintoA.id,
        inicio: enDias(30).toISOString(),
        ventaInicio: enDias(-1).toISOString(),
        zona: { nombre: 'Platea', precioCentavos: PRECIO, filas: 1, columnas: 4 },
      })
      .expect(201);
    await request(url).patch(`/eventos/${res.body.id}/publicar`).set('Authorization', auth).expect(200);
    const asientos = await prisma.asiento.findMany({
      where: { eventoId: res.body.id },
      orderBy: { columna: 'asc' },
      select: { id: true },
    });
    return { id: res.body.id as string, asientos: asientos.map((a) => a.id) };
  };

  const reservar = async (usuario: Usuario, eventoId: string, asientoIds: string[]): Promise<OrdenCreada> => {
    const res = await request(url)
      .post('/ordenes')
      .set('Authorization', `Bearer ${tokenDe(usuario)}`)
      .set('Idempotency-Key', randomUUID())
      .send({ eventoId, asientoIds })
      .expect(201);
    return res.body;
  };

  // Lo que dejaría POST /ordenes/:id/pago (todavía no existe).
  const pagoEnProceso = async (orden: OrdenCreada) => {
    const referencia = `sim_pay_${fx.prefijoPagos}_${randomUUID().slice(0, 8)}`;
    await prisma.pago.create({
      data: {
        ordenId: orden.ordenId,
        proveedor: 'simulador',
        referenciaExterna: referencia,
        montoCentavos: BigInt(orden.totalCentavos),
      },
    });
    return referencia;
  };

  // El cuerpo como texto: se firma y se envía exactamente así.
  const webhook = (orden: OrdenCreada, referencia: string, tipo = 'pago.exitoso') =>
    JSON.stringify({
      id: `sim_evt_${fx.prefijoPagos}_${randomUUID().slice(0, 8)}`,
      tipo,
      referencia,
      ordenId: orden.ordenId,
      montoCentavos: orden.totalCentavos,
      moneda: 'BOB',
    });

  // fetch y no supertest: supertest re-serializa el body y para P-01 hacen falta
  // envíos realmente paralelos (ver calentar en ordenes.e2e-spec).
  const enviar = async (cuerpo: string, firma = firmaSimulador(cuerpo)) => {
    const r = await fetch(`${url}/webhooks/pagos/simulador`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Simulador-Firma': firma },
      body: cuerpo,
    });
    return r.status;
  };

  const calentar = (conexiones: number) =>
    Promise.all([
      ...Array.from({ length: conexiones }, () => fetch(`${url}/health`).then((r) => r.text())),
      ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(0.05)`)),
    ]);

  const outboxDe = (ordenId: string) =>
    prisma.outbox.findMany({ where: { payload: { path: ['ordenId'], equals: ordenId } }, select: { tipo: true } });

  describe('P-01: webhook duplicado', () => {
    it('el mismo webhook ×5 en paralelo → 5 × 200, 1 registro y la orden PAGADA una sola vez', async () => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const asientos = evento.asientos.slice(0, 2);
      const orden = await reservar(ana, evento.id, asientos);
      const referencia = await pagoEnProceso(orden);
      const cuerpo = webhook(orden, referencia);

      await calentar(5);
      const estados = await Promise.all(Array.from({ length: 5 }, () => enviar(cuerpo)));

      // 200 también a los duplicados: con 4xx/5xx el proveedor seguiría reintentando.
      expect(estados).toEqual([200, 200, 200, 200, 200]);
      const { id } = JSON.parse(cuerpo) as { id: string };
      expect(await prisma.webhookEvento.count({ where: { proveedor: 'simulador', eventoExternoId: id } })).toBe(1);

      expect((await prisma.orden.findUniqueOrThrow({ where: { id: orden.ordenId } })).estado).toBe('PAGADA');
      expect(await prisma.pago.findMany({ where: { ordenId: orden.ordenId }, select: { estado: true } })).toEqual([
        { estado: 'CONFIRMADO' },
      ]);
      const filas = await prisma.asiento.findMany({ where: { id: { in: asientos } } });
      for (const a of filas) expect(a).toMatchObject({ estado: 'VENDIDO', ordenId: orden.ordenId, expiresAt: null });
      expect(await prisma.entrada.count({ where: { ordenId: orden.ordenId, estado: 'EMITIDA' } })).toBe(2);
      expect(await outboxDe(orden.ordenId)).toEqual([{ tipo: 'ENTRADAS_EMITIDAS' }]);
    });
  });

  describe('P-04: pago tardío con un asiento ya tomado', () => {
    it('otra orden vigente tiene un asiento → REEMBOLSO_REQUERIDO, ningún VENDIDO y los suyos liberados', async () => {
      const evento = await eventoALaVenta();
      const [ana, beto] = await fx.crearCompradores(2);
      const [a1, a2] = evento.asientos;
      const deAna = await reservar(ana, evento.id, [a1, a2]);
      const referencia = await pagoEnProceso(deAna);

      // La reserva de Ana vence por SQL (el job no corre) y Beto toma A2 por
      // expiración perezosa: su reserva está vigente.
      await prisma.$executeRaw`UPDATE ordenes SET expires_at = now() - interval '1 second' WHERE id = ${deAna.ordenId}::uuid`;
      await prisma.$executeRaw`UPDATE asientos SET expires_at = now() - interval '1 second' WHERE orden_id = ${deAna.ordenId}::uuid`;
      const deBeto = await reservar(beto, evento.id, [a2]);

      const cuerpo = webhook(deAna, referencia);
      expect(await enviar(cuerpo)).toBe(200);

      const estadoFinal = async () => ({
        orden: (await prisma.orden.findUniqueOrThrow({ where: { id: deAna.ordenId } })).estado,
        pagos: await prisma.pago.findMany({ where: { ordenId: deAna.ordenId }, select: { estado: true } }),
        a1: await prisma.asiento.findUniqueOrThrow({ where: { id: a1 }, select: { estado: true, ordenId: true } }),
        a2: await prisma.asiento.findUniqueOrThrow({ where: { id: a2 }, select: { estado: true, ordenId: true } }),
        entradas: await prisma.entrada.count({ where: { ordenId: deAna.ordenId } }),
        outbox: await outboxDe(deAna.ordenId),
        webhooks: await prisma.webhookEvento.count({ where: { eventoExternoId: JSON.parse(cuerpo).id } }),
      });

      const esperado = {
        orden: 'REEMBOLSO_REQUERIDO',
        // El dinero sí llegó: el pago queda CONFIRMADO aunque no haya entradas.
        pagos: [{ estado: 'CONFIRMADO' }],
        // Todo o nada: A1 NO quedó VENDIDO (prueba el ROLLBACK TO SAVEPOINT) y,
        // como era suyo, se libera.
        a1: { estado: 'LIBRE', ordenId: null },
        a2: { estado: 'RESERVADO', ordenId: deBeto.ordenId },
        entradas: 0,
        outbox: [{ tipo: 'REEMBOLSO_REQUERIDO' }],
        // El evento queda registrado aunque no hubo venta: un reintento es duplicado.
        webhooks: 1,
      };
      expect(await estadoFinal()).toEqual(esperado);

      // Reenvío del mismo evento: 200 y nada cambia.
      expect(await enviar(cuerpo)).toBe(200);
      expect(await estadoFinal()).toEqual(esperado);
    });
  });
});
