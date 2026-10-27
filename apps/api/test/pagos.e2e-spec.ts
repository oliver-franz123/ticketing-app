import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Rol } from '@entradas/db';
import { MODOS_SIMULADOR } from '@entradas/shared';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer as crearServidorHttp } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { type ResultadoDespacho, SimuladorPagosService } from '../src/simulador-pagos/simulador-pagos.service';
import { firmaSimulador, SECRETO_SIMULADOR } from './firma-simulador-prueba';
import { crearFixtures, enDias, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';

// Pagos contra el Postgres real: webhook idempotente y re-captura (doc 04 §4.3,
// doc 05 §4, ADR-0004) y POST /ordenes/:id/pago con el simulador (ADR-0015).
// En los tests del webhook el pago EN_PROCESO se inserta con Prisma y el test
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
    // Sin tick automático: cada test despacha a mano y sabe cuándo sale cada webhook.
    process.env.SIMULADOR_TICK_MS = '0';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // rawBody: la firma se verifica sobre los bytes exactos, no sobre el JSON re-serializado.
    app = configurarApp(modulo.createNestApplication({ rawBody: true }));
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    // SimuladorAdapter llama por HTTP a esta misma app (ADR-0015): el puerto es
    // aleatorio, así que la URL pública se fija después de listen.
    process.env.API_PUBLIC_URL = url;
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

  // El cuerpo como texto: se firma y se envía exactamente así. `cambios` pisa
  // cualquier campo (tipo, montoCentavos, moneda, id) para los casos raros.
  const webhook = (orden: OrdenCreada, referencia: string, cambios: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: `sim_evt_${fx.prefijoPagos}_${randomUUID().slice(0, 8)}`,
      tipo: 'pago.exitoso',
      referencia,
      ordenId: orden.ordenId,
      montoCentavos: orden.totalCentavos,
      moneda: 'BOB',
      ...cambios,
    });

  // fetch y no supertest: supertest re-serializa el body y para P-01 hacen falta
  // envíos realmente paralelos (ver calentar en ordenes.e2e-spec).
  // firma = null: sin cabecera.
  const enviar = async (
    cuerpo: string,
    firma: string | null = firmaSimulador(cuerpo),
    { proveedor = 'simulador', contentType = 'application/json' } = {},
  ) => {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (firma !== null) headers['Simulador-Firma'] = firma;
    const r = await fetch(`${url}/webhooks/pagos/${proveedor}`, { method: 'POST', headers, body: cuerpo });
    return r.status;
  };

  const calentar = (conexiones: number) =>
    Promise.all([
      ...Array.from({ length: conexiones }, () => fetch(`${url}/health`).then((r) => r.text())),
      ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(0.05)`)),
    ]);

  const outboxDe = (ordenId: string) =>
    prisma.outbox.findMany({ where: { payload: { path: ['ordenId'], equals: ordenId } }, select: { tipo: true } });

  // Todo lo que un webhook puede tocar de una orden, para comparar antes y después.
  // webhooks cuenta todos los eventos de esta corrida: un "nada cambia" también
  // detecta una fila registrada con un id inesperado.
  const estadoDe = async (orden: OrdenCreada) => ({
    orden: (await prisma.orden.findUniqueOrThrow({ where: { id: orden.ordenId } })).estado,
    pagos: await prisma.pago.findMany({ where: { ordenId: orden.ordenId }, select: { estado: true } }),
    asientos: await prisma.asiento.findMany({
      where: { items: { some: { ordenId: orden.ordenId } } },
      select: { id: true, estado: true, ordenId: true },
      orderBy: { id: 'asc' },
    }),
    entradas: await prisma.entrada.count({ where: { ordenId: orden.ordenId } }),
    outbox: await outboxDe(orden.ordenId),
    webhooks: await prisma.webhookEvento.count({ where: { eventoExternoId: { contains: fx.prefijoPagos } } }),
  });

  // Vence la reserva por SQL, sin que corra el job (como C-04).
  const vencer = async (orden: OrdenCreada) => {
    await prisma.$executeRaw`UPDATE ordenes SET expires_at = now() - interval '1 second' WHERE id = ${orden.ordenId}::uuid`;
    await prisma.$executeRaw`UPDATE asientos SET expires_at = now() - interval '1 second' WHERE orden_id = ${orden.ordenId}::uuid AND estado = 'RESERVADO'`;
  };

  // Absoluta (el navegador viene desde la web, otro dominio) y con una
  // referencia que no se puede adivinar: la página del simulador es pública.
  const URL_DE_PAGO = /\/simulador\/pagar\/(sim_pay_[0-9a-f]{32})$/;
  const referenciaDe = (redirectUrl: string) => URL_DE_PAGO.exec(redirectUrl)![1];

  const pagar = (usuario: Usuario | null, ordenId: string) => {
    let req = request(url).post(`/ordenes/${ordenId}/pago`);
    if (usuario) req = req.set('Authorization', `Bearer ${tokenDe(usuario)}`);
    return req;
  };

  const ordenReservada = async () => {
    const evento = await eventoALaVenta();
    const [ana] = await fx.crearCompradores(1);
    const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
    return { ana, orden };
  };

  const pagosDe = (orden: OrdenCreada) =>
    prisma.pago.findMany({
      where: { ordenId: orden.ordenId },
      select: { proveedor: true, referenciaExterna: true, estado: true, montoCentavos: true },
      orderBy: { creadoEn: 'asc' },
    });

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

  describe('referencia desconocida: no se registra', () => {
    it('un pago que no existe → 200 sin fila en webhook_eventos; cuando el pago existe, el mismo evento se procesa', async () => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = `sim_pay_${fx.prefijoPagos}_${randomUUID().slice(0, 8)}`;
      const cuerpo = webhook(orden, referencia);
      const antes = await estadoDe(orden);

      // El pago todavía no existe: 200 (no forzar reintentos de algo que no
      // conocemos) pero el evento NO queda registrado.
      expect(await enviar(cuerpo)).toBe(200);
      expect(await estadoDe(orden)).toEqual(antes);

      // Ahora el pago existe: el MISMO evento (mismo id) ya no es duplicado.
      await prisma.pago.create({
        data: {
          ordenId: orden.ordenId,
          proveedor: 'simulador',
          referenciaExterna: referencia,
          montoCentavos: BigInt(orden.totalCentavos),
        },
      });
      expect(await enviar(cuerpo)).toBe(200);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA', entradas: 2, webhooks: antes.webhooks + 1 });
    });

    it('una referencia de OTRA orden → 200 y no toca ninguna de las dos', async () => {
      const evento = await eventoALaVenta();
      const [ana, beto] = await fx.crearCompradores(2);
      const deAna = await reservar(ana, evento.id, [evento.asientos[0]]);
      const deBeto = await reservar(beto, evento.id, [evento.asientos[1]]);
      const referenciaDeAna = await pagoEnProceso(deAna);
      const antes = [await estadoDe(deAna), await estadoDe(deBeto)];

      // Firmado bien, pero dice "esta referencia paga la orden de Beto".
      expect(await enviar(webhook(deBeto, referenciaDeAna))).toBe(200);
      expect([await estadoDe(deAna), await estadoDe(deBeto)]).toEqual(antes);
    });
  });

  describe('P-02: firma inválida', () => {
    it.each([
      ['firmado con otro secreto', (c: string) => firmaSimulador(c, { secreto: 'otro-secreto-de-prueba-de-32-bytes-!!!!' })],
      ['cuerpo alterado después de firmar', (c: string) => firmaSimulador(c.replace('"BOB"', '"BOB" '))],
      ['t de hace 6 minutos (replay)', (c: string) => firmaSimulador(c, { t: Math.floor(Date.now() / 1000) - 360 })],
      ['sin cabecera', () => null],
      ['cabecera basura', () => 't=1,v1=xyz'],
    ])('%s → 400 y nada cambia', async (_caso, firmar) => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);
      const cuerpo = webhook(orden, referencia);
      const antes = await estadoDe(orden);

      expect(await enviar(cuerpo, firmar(cuerpo))).toBe(400);
      expect(await estadoDe(orden)).toEqual(antes);
    });

    it('Content-Type que no es JSON (sin raw body) → 400', async () => {
      const cuerpo = JSON.stringify({ id: 'sim_evt_x' });
      expect(await enviar(cuerpo, firmaSimulador(cuerpo), { contentType: 'text/plain' })).toBe(400);
    });

    it('proveedor no habilitado → 404', async () => {
      const cuerpo = JSON.stringify({ id: 'sim_evt_x' });
      expect(await enviar(cuerpo, firmaSimulador(cuerpo), { proveedor: 'paypal' })).toBe(404);
    });
  });

  describe('P-03: pago tardío que recupera todos sus asientos', () => {
    const pagaTarde = async (preparar: (orden: OrdenCreada, otro: Usuario, eventoId: string) => Promise<void>) => {
      const evento = await eventoALaVenta();
      const [ana, beto] = await fx.crearCompradores(2);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);
      await vencer(orden);
      await preparar(orden, beto, evento.id);

      expect(await enviar(webhook(orden, referencia))).toBe(200);
      const final = await estadoDe(orden);
      expect(final).toMatchObject({ orden: 'PAGADA', pagos: [{ estado: 'CONFIRMADO' }], entradas: 2 });
      expect(final.outbox).toEqual([{ tipo: 'ENTRADAS_EMITIDAS' }]);
      for (const a of final.asientos) expect(a).toMatchObject({ estado: 'VENDIDO', ordenId: orden.ordenId });
    };

    it('a) los asientos siguen RESERVADO con su orden_id (el job no corrió)', () => pagaTarde(async () => {}));

    it('b) el job ya los liberó (LIBRE) y la orden quedó EXPIRADA', () =>
      pagaTarde(async (orden) => {
        await prisma.$executeRaw`UPDATE asientos SET estado = 'LIBRE', orden_id = NULL, expires_at = NULL WHERE orden_id = ${orden.ordenId}::uuid`;
        await prisma.$executeRaw`UPDATE ordenes SET estado = 'EXPIRADA' WHERE id = ${orden.ordenId}::uuid`;
      }));

    it('c) otra orden tomó un asiento y su reserva también venció', () =>
      pagaTarde(async (orden, beto, eventoId) => {
        const [, a2] = (await estadoDe(orden)).asientos.map((a) => a.id);
        const deBeto = await reservar(beto, eventoId, [a2]);
        await vencer(deBeto);
      }));
  });

  describe('P-05: rechazo y desorden', () => {
    it('pago.fallido → pago FALLIDO; la orden sigue PENDIENTE_PAGO con sus asientos RESERVADO', async () => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);

      expect(await enviar(webhook(orden, referencia, { tipo: 'pago.fallido' }))).toBe(200);
      const final = await estadoDe(orden);
      expect(final).toMatchObject({ orden: 'PENDIENTE_PAGO', pagos: [{ estado: 'FALLIDO' }], entradas: 0, outbox: [] });
      for (const a of final.asientos) expect(a).toMatchObject({ estado: 'RESERVADO', ordenId: orden.ordenId });
    });

    it('FALLIDO después de EXITOSO → la orden sigue PAGADA y el pago CONFIRMADO', async () => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);

      expect(await enviar(webhook(orden, referencia))).toBe(200);
      const pagada = await estadoDe(orden);
      expect(await enviar(webhook(orden, referencia, { tipo: 'pago.fallido' }))).toBe(200);

      // Solo cambia que el segundo evento quedó registrado.
      expect(await estadoDe(orden)).toEqual({ ...pagada, webhooks: pagada.webhooks + 1 });
      expect(pagada).toMatchObject({ orden: 'PAGADA', pagos: [{ estado: 'CONFIRMADO' }] });
    });
  });

  describe('P-06: monto o moneda distintos', () => {
    it.each([
      ['un centavo menos', (o: OrdenCreada) => ({ montoCentavos: o.totalCentavos - 1 })],
      ['otra moneda', () => ({ moneda: 'USD' })],
    ])('%s → REVISION_MANUAL, pago CONFIRMADO, 0 entradas y asientos sin vender', async (_caso, cambios) => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);

      expect(await enviar(webhook(orden, referencia, cambios(orden)))).toBe(200);
      const final = await estadoDe(orden);
      expect(final).toMatchObject({ orden: 'REVISION_MANUAL', pagos: [{ estado: 'CONFIRMADO' }], entradas: 0, outbox: [] });
      for (const a of final.asientos) expect(a.estado).toBe('RESERVADO');
    });
  });

  describe('P-07: dos eventos distintos del mismo cobro', () => {
    it('en paralelo → 2 × 200, 2 eventos registrados, 1 pago y 1 conjunto de entradas', async () => {
      const evento = await eventoALaVenta();
      const [ana] = await fx.crearCompradores(1);
      const orden = await reservar(ana, evento.id, evento.asientos.slice(0, 2));
      const referencia = await pagoEnProceso(orden);
      const antes = await estadoDe(orden);

      await calentar(2);
      // Ids distintos: la idempotencia de webhook_eventos NO los frena. Lo hace
      // el FOR UPDATE de la orden + el estado ya PAGADA (ORDEN_YA_RESUELTA).
      const estados = await Promise.all([enviar(webhook(orden, referencia)), enviar(webhook(orden, referencia))]);

      expect(estados).toEqual([200, 200]);
      const final = await estadoDe(orden);
      expect(final).toMatchObject({
        orden: 'PAGADA',
        pagos: [{ estado: 'CONFIRMADO' }],
        entradas: 2,
        webhooks: antes.webhooks + 2,
      });
      expect(final.outbox).toEqual([{ tipo: 'ENTRADAS_EMITIDAS' }]);
    });
  });

  describe('POST /ordenes/:id/pago', () => {
    it('200 {proveedor, redirectUrl}: pago EN_PROCESO en la API y PENDIENTE en el simulador', async () => {
      const { ana, orden } = await ordenReservada();
      const res = await pagar(ana, orden.ordenId).expect(200);

      expect(res.body).toEqual({ proveedor: 'simulador', redirectUrl: expect.stringMatching(URL_DE_PAGO) });
      expect(res.body.redirectUrl.startsWith(`${url}/simulador/pagar/`)).toBe(true);
      const referencia = referenciaDe(res.body.redirectUrl);
      expect(await pagosDe(orden)).toEqual([
        {
          proveedor: 'simulador',
          referenciaExterna: referencia,
          estado: 'EN_PROCESO',
          montoCentavos: BigInt(orden.totalCentavos),
        },
      ]);
      // El simulador guardó su propio registro: otro "sistema", sin FK a nada.
      // enviar_en NULL: no hay nada que enviar hasta que el comprador confirme.
      expect(await prisma.simuladorPago.findUnique({ where: { referencia } })).toMatchObject({
        ordenId: orden.ordenId,
        montoCentavos: BigInt(orden.totalCentavos),
        moneda: 'BOB',
        estado: 'PENDIENTE',
        enviarEn: null,
      });
    });

    it('401 sin JWT, 403 si no es COMPRADOR y 400 si el id no es un UUID', async () => {
      const { ana, orden } = await ordenReservada();
      await pagar(null, orden.ordenId).expect(401);
      await pagar(fx.usuarios.organizadorA, orden.ordenId).expect(403);
      await pagar(ana, 'no-es-un-uuid').expect(400);
      expect(await pagosDe(orden)).toEqual([]);
    });

    it('404 con el mismo mensaje si la orden no existe o es de otro comprador', async () => {
      const { orden } = await ordenReservada();
      const [beto] = await fx.crearCompradores(1);

      const ajena = await pagar(beto, orden.ordenId).expect(404);
      const inexistente = await pagar(beto, randomUUID()).expect(404);

      // El mensaje propio y no el "Cannot POST" de una ruta que no existe.
      expect(ajena.body.message).toBe('Orden no encontrada');
      expect(inexistente.body).toEqual(ajena.body);
      expect(await pagosDe(orden)).toEqual([]);
    });

    it.each([
      ['venció (sin que corra el job)', (o: OrdenCreada) => vencer(o)],
      [
        'ya está EXPIRADA',
        (o: OrdenCreada) => prisma.$executeRaw`UPDATE ordenes SET estado = 'EXPIRADA' WHERE id = ${o.ordenId}::uuid`,
      ],
    ])('una orden que %s → 409 ORDEN_NO_PAGABLE sin crear pagos', async (_caso, preparar) => {
      const { ana, orden } = await ordenReservada();
      await preparar(orden);

      const res = await pagar(ana, orden.ordenId).expect(409);
      expect(res.body.codigo).toBe('ORDEN_NO_PAGABLE');
      expect(await pagosDe(orden)).toEqual([]);
    });

    it('doble clic: dos POST en paralelo → el mismo redirectUrl, el del pago guardado', async () => {
      const { ana, orden } = await ordenReservada();
      await calentar(2);

      const respuestas = await Promise.all(
        [1, 2].map(async () => {
          const r = await fetch(`${url}/ordenes/${orden.ordenId}/pago`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokenDe(ana)}` },
          });
          return { status: r.status, body: (await r.json()) as { proveedor: string; redirectUrl: string } };
        }),
      );

      expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
      // El perdedor devuelve la URL del ganador, armada desde la referencia guardada.
      expect(respuestas[1].body).toEqual(respuestas[0].body);
      // Nunca dos cobros vivos para la misma orden. (El simulador puede tener
      // una fila de más, PENDIENTE para siempre: un intento abandonado.)
      const pagos = await pagosDe(orden);
      expect(pagos.map((p) => p.estado)).toEqual(['EN_PROCESO']);
      expect(referenciaDe(respuestas[0].body.redirectUrl)).toBe(pagos[0].referenciaExterna);
    });

    it('de punta a punta: pagar → webhook firmado con esa referencia → PAGADA; pagar de nuevo → 409', async () => {
      const { ana, orden } = await ordenReservada();
      const referencia = referenciaDe((await pagar(ana, orden.ordenId).expect(200)).body.redirectUrl);

      expect(await enviar(webhook(orden, referencia))).toBe(200);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA', pagos: [{ estado: 'CONFIRMADO' }], entradas: 2 });

      const otraVez = await pagar(ana, orden.ordenId).expect(409);
      expect(otraVez.body.codigo).toBe('ORDEN_NO_PAGABLE');
    });

    it('tras un rechazo se puede reintentar: un pago nuevo con otra referencia', async () => {
      const { ana, orden } = await ordenReservada();
      const primera = referenciaDe((await pagar(ana, orden.ordenId).expect(200)).body.redirectUrl);
      expect(await enviar(webhook(orden, primera, { tipo: 'pago.fallido' }))).toBe(200);

      const segunda = referenciaDe((await pagar(ana, orden.ordenId).expect(200)).body.redirectUrl);

      expect(segunda).not.toBe(primera);
      expect((await pagosDe(orden)).map((p) => [p.referenciaExterna, p.estado])).toEqual([
        [primera, 'FALLIDO'],
        [segunda, 'EN_PROCESO'],
      ]);
    });

    it('502 si el proveedor no responde: mensaje genérico y nada en pagos ni en el simulador', async () => {
      const { ana, orden } = await ordenReservada();
      // Un puerto que estuvo abierto y se cerró: la conexión se rechaza al instante.
      const puertoCerrado = await new Promise<number>((resolve) => {
        const servidor = createServer().listen(0, '127.0.0.1', () => {
          const { port } = servidor.address() as AddressInfo;
          servidor.close(() => resolve(port));
        });
      });

      process.env.API_PUBLIC_URL = `http://127.0.0.1:${puertoCerrado}`;
      try {
        const res = await pagar(ana, orden.ordenId).expect(502);
        expect(res.body.message).toBe('El proveedor de pagos no respondió');
      } finally {
        // Los demás tests necesitan la URL real.
        process.env.API_PUBLIC_URL = url;
      }
      expect(await pagosDe(orden)).toEqual([]);
      expect(await prisma.simuladorPago.count({ where: { ordenId: orden.ordenId } })).toBe(0);
    });

    it('la orden vence mientras se espera al proveedor → 409 ORDEN_NO_PAGABLE y 0 filas en pagos', async () => {
      const { ana, orden } = await ordenReservada();

      // Proveedor falso: al recibir el intento, vence la orden por SQL y recién
      // entonces responde 201 con una referencia válida. Así se abre a propósito
      // la ventana entre el paso 1 de iniciarPago (la orden todavía era pagable)
      // y el INSERT: solo el WHERE del INSERT … SELECT puede detectarlo.
      const proveedorLento = crearServidorHttp((req, res) => {
        req.resume();
        req.on('end', () => {
          prisma.$executeRaw`UPDATE ordenes SET expires_at = now() - interval '1 second' WHERE id = ${orden.ordenId}::uuid`
            .then(() => {
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ referencia: `sim_pay_${randomBytes(16).toString('hex')}` }));
            })
            // Si el UPDATE fallara, la API respondería 502 y el test fallaría a la vista.
            .catch(() => res.writeHead(500).end());
        });
      });
      await new Promise<void>((listo) => proveedorLento.listen(0, '127.0.0.1', listo));
      const { port } = proveedorLento.address() as AddressInfo;

      process.env.API_PUBLIC_URL = `http://127.0.0.1:${port}`;
      try {
        const res = await pagar(ana, orden.ordenId).expect(409);
        expect(res.body.codigo).toBe('ORDEN_NO_PAGABLE');
      } finally {
        process.env.API_PUBLIC_URL = url;
        await new Promise((cerrado) => proveedorLento.close(cerrado));
      }
      expect(await pagosDe(orden)).toEqual([]);
    });
  });

  describe('Simulador: página, modos y despacho', () => {
    const despachar = async (referencia: string) =>
      // Solo lo de esta referencia: en la BD puede haber restos de otras corridas.
      (await app.get(SimuladorPagosService).despacharPendientes()).filter((r) => r.referencia === referencia);

    const pagoCreado = async () => {
      const { ana, orden } = await ordenReservada();
      const referencia = referenciaDe((await pagar(ana, orden.ordenId).expect(200)).body.redirectUrl);
      return { orden, referencia };
    };

    const confirmar = (referencia: string, campos: Record<string, string>) =>
      request(url).post(`/simulador/pagar/${referencia}`).type('form').send(campos);

    const filaSimulador = (referencia: string) => prisma.simuladorPago.findUniqueOrThrow({ where: { referencia } });

    const eventosDe = (referencia: string) =>
      prisma.webhookEvento.findMany({
        where: { eventoExternoId: { startsWith: referencia.replace('sim_pay_', 'sim_evt_') } },
        select: { tipo: true },
        orderBy: { id: 'asc' },
      });

    // Segundos que faltan para el próximo envío, con el reloj de Postgres.
    const segundosHastaEnvio = async (referencia: string) => {
      const [{ s }] = await prisma.$queryRaw<{ s: number }[]>`
        SELECT extract(epoch FROM enviar_en - now())::float AS s FROM simulador_pagos WHERE referencia = ${referencia}`;
      return s;
    };

    const conProveedorCaido = async <T>(accion: () => Promise<T>) => {
      const puerto = await new Promise<number>((resolve) => {
        const s = createServer().listen(0, '127.0.0.1', () => {
          const { port } = s.address() as AddressInfo;
          s.close(() => resolve(port));
        });
      });
      process.env.API_PUBLIC_URL = `http://127.0.0.1:${puerto}`;
      try {
        return await accion();
      } finally {
        process.env.API_PUBLIC_URL = url;
      }
    };

    it('sin confirmación no sale ningún webhook; al confirmar OK, el siguiente despacho lo entrega y la orden queda PAGADA', async () => {
      const { orden, referencia } = await pagoCreado();

      // enviar_en NULL: el despacho no la toca.
      expect(await despachar(referencia)).toEqual([]);
      expect(await filaSimulador(referencia)).toMatchObject({ estado: 'PENDIENTE', enviarEn: null, intentosEntrega: 0 });
      expect(await eventosDe(referencia)).toEqual([]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PENDIENTE_PAGO', pagos: [{ estado: 'EN_PROCESO' }] });

      await confirmar(referencia, { modo: 'OK' }).expect(200);
      expect(await despachar(referencia)).toEqual([{ referencia, envios: 1, entregado: true }]);

      expect(await eventosDe(referencia)).toEqual([{ tipo: 'EXITOSO' }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA', pagos: [{ estado: 'CONFIRMADO' }], entradas: 2 });
      expect(await filaSimulador(referencia)).toMatchObject({ estado: 'PAGADO', enviarEn: null });
      // Entregado: no se vuelve a enviar.
      expect(await despachar(referencia)).toEqual([]);
    });

    it('GET /simulador/pagar/:ref: página con el monto en Bs y los modos; referencia desconocida → 404', async () => {
      const { referencia } = await pagoCreado();
      const res = await request(url)
        .get(`/simulador/pagar/${referencia}`)
        .expect(200)
        .expect('Content-Type', /text\/html/);

      // 2 asientos × Bs 150,50, con el formato de Bolivia.
      expect(res.text).toContain('301,00');
      for (const modo of MODOS_SIMULADOR) expect(res.text).toContain(`value="${modo}"`);
      await request(url).get(`/simulador/pagar/sim_pay_${'0'.repeat(32)}`).expect(404);
    });

    it('RECHAZO → pago FALLIDO; la orden sigue PENDIENTE_PAGO', async () => {
      const { orden, referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'RECHAZO' }).expect(200);

      expect(await despachar(referencia)).toEqual([{ referencia, envios: 1, entregado: true }]);
      expect(await eventosDe(referencia)).toEqual([{ tipo: 'FALLIDO' }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PENDIENTE_PAGO', pagos: [{ estado: 'FALLIDO' }], entradas: 0 });
      expect(await filaSimulador(referencia)).toMatchObject({ estado: 'RECHAZADO', enviarEn: null });
    });

    it('DUPLICAR veces=5 → 5 envíos en paralelo del MISMO evento, 1 registro y la orden PAGADA una vez (P-01 de punta a punta)', async () => {
      const { orden, referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'DUPLICAR', veces: '5' }).expect(200);

      expect(await despachar(referencia)).toEqual([{ referencia, envios: 5, entregado: true }]);
      expect(await eventosDe(referencia)).toEqual([{ tipo: 'EXITOSO' }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA', entradas: 2, outbox: [{ tipo: 'ENTRADAS_EMITIDAS' }] });
    });

    it('DEMORA s=120 → nada sale antes de tiempo; al llegar la hora, se entrega', async () => {
      const { orden, referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'DEMORA', s: '120' }).expect(200);

      expect(await despachar(referencia)).toEqual([]);
      const faltan = await segundosHastaEnvio(referencia);
      expect(faltan).toBeGreaterThan(115);
      expect(faltan).toBeLessThanOrEqual(120);

      // Se adelanta el reloj de esta fila en lugar de esperar 2 minutos.
      await prisma.$executeRaw`UPDATE simulador_pagos SET enviar_en = now() WHERE referencia = ${referencia}`;
      expect(await despachar(referencia)).toEqual([{ referencia, envios: 1, entregado: true }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA' });
    });

    it('DESORDEN → EXITOSO y después FALLIDO del mismo pago: la orden queda PAGADA (P-05 de punta a punta)', async () => {
      const { orden, referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'DESORDEN' }).expect(200);

      expect(await despachar(referencia)).toEqual([{ referencia, envios: 2, entregado: true }]);
      expect(await eventosDe(referencia)).toEqual([{ tipo: 'EXITOSO' }, { tipo: 'FALLIDO' }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA', pagos: [{ estado: 'CONFIRMADO' }], entradas: 2 });
    });

    it('confirmar dos veces → la segunda da 409 y no cambia el modo', async () => {
      const { referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'OK' }).expect(200);
      await confirmar(referencia, { modo: 'RECHAZO' }).expect(409);
      expect(await filaSimulador(referencia)).toMatchObject({ modo: 'OK', estado: 'PAGADO' });
    });

    it.each([
      ['modo desconocido', { modo: 'MONTO_ERRONEO' }],
      ['DUPLICAR con veces=1', { modo: 'DUPLICAR', veces: '1' }],
      ['DUPLICAR con veces=11', { modo: 'DUPLICAR', veces: '11' }],
      ['DUPLICAR sin veces', { modo: 'DUPLICAR' }],
      ['DEMORA con s=0', { modo: 'DEMORA', s: '0' }],
      ['DEMORA con s=601', { modo: 'DEMORA', s: '601' }],
      ['DEMORA sin s', { modo: 'DEMORA' }],
    ])('%s → 400 y el pago sigue PENDIENTE', async (_caso, campos) => {
      const { referencia } = await pagoCreado();
      await confirmar(referencia, campos).expect(400);
      expect(await filaSimulador(referencia)).toMatchObject({ estado: 'PENDIENTE', enviarEn: null });
    });

    it('la API no responde → reintento a los 5 s; cuando vuelve, se entrega', async () => {
      const { orden, referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'OK' }).expect(200);

      expect(await conProveedorCaido(() => despachar(referencia))).toEqual([{ referencia, envios: 1, entregado: false }]);
      expect(await filaSimulador(referencia)).toMatchObject({ estado: 'PAGADO', intentosEntrega: 1 });
      const faltan = await segundosHastaEnvio(referencia);
      expect(faltan).toBeGreaterThan(4);
      expect(faltan).toBeLessThanOrEqual(5);

      await prisma.$executeRaw`UPDATE simulador_pagos SET enviar_en = now() WHERE referencia = ${referencia}`;
      expect(await despachar(referencia)).toEqual([{ referencia, envios: 1, entregado: true }]);
      expect(await estadoDe(orden)).toMatchObject({ orden: 'PAGADA' });
      expect(await filaSimulador(referencia)).toMatchObject({ enviarEn: null });
    });

    it('backoff 5 s, 30 s, 2 min, 10 min; tras el 5.º intento fallido se rinde', async () => {
      const { referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'OK' }).expect(200);

      for (const [intentos, segundos] of [[1, 5], [2, 30], [3, 120], [4, 600]] as const) {
        // Se adelanta enviar_en por SQL: ningún test espera segundos reales.
        await prisma.$executeRaw`UPDATE simulador_pagos SET enviar_en = now() WHERE referencia = ${referencia}`;
        expect(await conProveedorCaido(() => despachar(referencia))).toEqual([{ referencia, envios: 1, entregado: false }]);
        expect(await filaSimulador(referencia)).toMatchObject({ intentosEntrega: intentos });
        const faltan = await segundosHastaEnvio(referencia);
        expect(faltan).toBeGreaterThan(segundos - 1);
        expect(faltan).toBeLessThanOrEqual(segundos);
      }

      await prisma.$executeRaw`UPDATE simulador_pagos SET enviar_en = now() WHERE referencia = ${referencia}`;
      expect(await conProveedorCaido(() => despachar(referencia))).toEqual([{ referencia, envios: 1, entregado: false }]);
      // Agotado: no hay próximo envío (lo recuperaría la reconciliación).
      expect(await filaSimulador(referencia)).toMatchObject({ intentosEntrega: 5, enviarEn: null });
      expect(await despachar(referencia)).toEqual([]);
    });

    it('una fila con el lease tomado por otra instancia (sin commit) no se despacha ni se espera (FOR UPDATE SKIP LOCKED)', async () => {
      const { referencia } = await pagoCreado();
      await confirmar(referencia, { modo: 'OK' }).expect(200);

      let otraInstanciaTermino = false;
      let despacho!: Promise<ResultadoDespacho[]>;
      let terminoAntesQueLaOtra = false;

      // "Otra instancia" toma el lease: corre enviar_en 30 s y mantiene la fila
      // bloqueada sin confirmar. Mientras tanto, este proceso despacha por otra
      // conexión del pool.
      await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`UPDATE simulador_pagos SET enviar_en = now() + interval '30 seconds' WHERE referencia = ${referencia}`;
          despacho = despachar(referencia);
          void despacho.then(() => {
            terminoAntesQueLaOtra = !otraInstanciaTermino;
          });
          // Tiempo de sobra para que el despacho llegue a la fila bloqueada
          // (500 ms: margen para un runner de CI lento).
          await new Promise((listo) => setTimeout(listo, 500));
        },
        { timeout: 5000 },
      );
      otraInstanciaTermino = true;

      // SKIP LOCKED: no la toma y no espera al lock. Sin el lock, el despacho
      // espera, y al confirmarse la otra transacción la toma igual con la foto
      // vieja: el webhook saldría dos veces.
      expect(await despacho).toEqual([]);
      expect(terminoAntesQueLaOtra).toBe(true);
      expect(await eventosDe(referencia)).toEqual([]);
    });
  });
});
