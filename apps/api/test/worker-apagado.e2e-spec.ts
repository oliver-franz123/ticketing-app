import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { SimuladorPagosService } from '../src/simulador-pagos/simulador-pagos.service';
import { SECRETO_SIMULADOR } from './firma-simulador-prueba';
import { crearFixtures, enDias, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';

// W-01 (doc 10 §2.3, ADR-0017): con el Worker apagado la API sigue vendiendo.
// En este proceso no corre ningún Worker: las compras completas dejan las
// órdenes PAGADAS y el trabajo pendiente acumulado en el outbox. Lo que pasa al
// volver el Worker (W-02) se prueba en apps/worker.
describe('W-01: la API vende con el Worker apagado', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    process.env.SIMULADOR_WEBHOOK_SECRET = SECRETO_SIMULADOR;
    // Sin tick automático: el test despacha los webhooks a mano.
    process.env.SIMULADOR_TICK_MS = '0';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication({ rawBody: true }));
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    process.env.API_PUBLIC_URL = url;
    prisma = app.get(PrismaService);
    fx = await crearFixtures(prisma);
  });

  afterAll(async () => {
    await fx?.limpiar();
    await app.close();
  });

  it('3 compras completas → 3 órdenes PAGADAS con sus entradas y 3 filas ENTRADAS_EMITIDAS pendientes', async () => {
    const auth = `Bearer ${tokenDe(fx.usuarios.organizadorA)}`;
    const evento = await request(url)
      .post('/eventos')
      .set('Authorization', auth)
      .send({
        titulo: `W-01 ${randomUUID().slice(0, 8)}`,
        recintoId: fx.recintoA.id,
        inicio: enDias(30).toISOString(),
        ventaInicio: enDias(-1).toISOString(),
        zona: { nombre: 'Platea', precioCentavos: 10000, filas: 1, columnas: 6 },
      })
      .expect(201);
    await request(url).patch(`/eventos/${evento.body.id}/publicar`).set('Authorization', auth).expect(200);
    const asientos = await prisma.asiento.findMany({
      where: { eventoId: evento.body.id },
      orderBy: { columna: 'asc' },
      select: { id: true },
    });
    const compradores = await fx.crearCompradores(3);

    // Compra completa, como desde la web: reservar 2 asientos, pagar, confirmar
    // en la página del simulador y que el simulador entregue el webhook firmado.
    const ordenes: string[] = [];
    for (const [i, comprador] of compradores.entries()) {
      const token = `Bearer ${tokenDe(comprador)}`;
      const orden = await request(url)
        .post('/ordenes')
        .set('Authorization', token)
        .set('Idempotency-Key', randomUUID())
        .send({ eventoId: evento.body.id, asientoIds: asientos.slice(2 * i, 2 * i + 2).map((a) => a.id) })
        .expect(201);
      const pago = await request(url).post(`/ordenes/${orden.body.ordenId}/pago`).set('Authorization', token).expect(200);
      const referencia = /(sim_pay_[0-9a-f]{32})$/.exec(pago.body.redirectUrl)![1];
      await request(url).post(`/simulador/pagar/${referencia}`).type('form').send({ modo: 'OK' }).expect(200);
      ordenes.push(orden.body.ordenId);
    }
    const entregas = await app.get(SimuladorPagosService).despacharPendientes();
    expect(entregas.filter((e) => e.entregado)).toHaveLength(3);

    for (const ordenId of ordenes) {
      expect((await prisma.orden.findUniqueOrThrow({ where: { id: ordenId } })).estado).toBe('PAGADA');
      expect(await prisma.entrada.count({ where: { ordenId, estado: 'EMITIDA' } })).toBe(2);
    }
    // El trabajo del Worker queda esperando, durable en Postgres.
    const pendientes = await prisma.$queryRaw<{ tipo: string }[]>`
      SELECT tipo FROM outbox WHERE publicado_en IS NULL AND payload->>'ordenId' = ANY(${ordenes}::text[])`;
    expect(pendientes).toEqual(Array(3).fill({ tipo: 'ENTRADAS_EMITIDAS' }));
    // Nadie mandó emails: no hay Worker.
    expect(await prisma.envioEmail.count({ where: { ordenId: { in: ordenes } } })).toBe(0);
  });
});
