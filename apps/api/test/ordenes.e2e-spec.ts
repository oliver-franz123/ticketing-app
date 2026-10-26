import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Rol } from '@entradas/db';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearFixtures, enDias, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';

// Reserva de asientos (doc 04 §4.1) contra el Postgres real de docker compose.
// Sin mocks de la BD: un mock no tiene locks ni re-evaluación del WHERE (doc 10 §1).
type Usuario = { id: string; rol: Rol };
type Respuesta = { status: number; body: { ordenId?: string; codigo?: string; noDisponibles?: string[] } };

const PRECIO = 15050;

describe('Órdenes: reserva de asientos', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication());
    // Un solo listen: con request(app.getHttpServer()) supertest abre el
    // servidor en cada petición y eso escalona las 50 de la carrera.
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    fx = await crearFixtures(prisma);
  });

  afterAll(async () => {
    await fx?.limpiar();
    await app.close();
  });

  // Evento PUBLICADO con la venta abierta desde ayer, creado y publicado por la API.
  // Devuelve los ids de los asientos en orden A1, A2… para elegirlos por posición.
  const eventoALaVenta = async (filas = 2, columnas = 5) => {
    const auth = `Bearer ${tokenDe(fx.usuarios.organizadorA)}`;
    const res = await request(url)
      .post('/eventos')
      .set('Authorization', auth)
      .send({
        titulo: `Reservas ${randomUUID().slice(0, 8)}`,
        recintoId: fx.recintoA.id,
        inicio: enDias(30).toISOString(),
        ventaInicio: enDias(-1).toISOString(),
        zona: { nombre: 'Platea', precioCentavos: PRECIO, filas, columnas },
      })
      .expect(201);
    await request(url).patch(`/eventos/${res.body.id}/publicar`).set('Authorization', auth).expect(200);

    const asientos = await prisma.asiento.findMany({
      where: { eventoId: res.body.id },
      orderBy: [{ fila: 'asc' }, { columna: 'asc' }],
      select: { id: true },
    });
    return { id: res.body.id as string, asientos: asientos.map((a) => a.id) };
  };

  const reservar = (usuario: Usuario | null, body: object, clave: string | null = randomUUID()) => {
    let req = request(url).post('/ordenes').send(body);
    if (usuario) req = req.set('Authorization', `Bearer ${tokenDe(usuario)}`);
    if (clave !== null) req = req.set('Idempotency-Key', clave);
    return req;
  };

  // Para las carreras: fetch (undici) en vez de supertest. Primero se abren N
  // conexiones keep-alive con /health; así las N peticiones salen juntas por
  // sockets ya abiertos, en vez de escalonarse abriendo una conexión TCP cada una.
  // También se llena el pool de Postgres (10 conexiones por defecto en pg): si
  // no, la primera transacción usa la única conexión abierta y termina antes de
  // que las demás consigan la suya (~10 ms en abrir cada una).
  const carrera = async (peticiones: { usuario: Usuario; body: object; clave?: string }[]): Promise<Respuesta[]> => {
    await Promise.all([
      ...peticiones.map(() => fetch(`${url}/health`).then((r) => r.text())),
      ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(0.05)`)),
    ]);
    const pedidos = peticiones.map(({ usuario, body, clave = randomUUID() }) => ({
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenDe(usuario)}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': clave,
      },
      body: JSON.stringify(body),
    }));
    return Promise.all(
      pedidos.map(async (pedido) => {
        const r = await fetch(`${url}/ordenes`, pedido);
        return { status: r.status, body: (await r.json()) as Respuesta['body'] };
      }),
    );
  };

  describe('C-01: la carrera', () => {
    it('50 compradores distintos por el mismo asiento → exactamente 1 × 201 y 49 × 409', async () => {
      const evento = await eventoALaVenta();
      const [calentador, ...compradores] = await fx.crearCompradores(51);
      const asiento = evento.asientos[0];

      // Calentamiento con otro asiento: la primera petición paga el arranque en
      // frío (JIT, conexiones del pool) y llegaría sola, ganando por tiempo y no
      // por el SQL. Así las 50 compiten de verdad (con la versión ingenua ganan varias).
      await reservar(calentador, { eventoId: evento.id, asientoIds: [evento.asientos[1]] }).expect(201);

      const respuestas = await carrera(
        compradores.map((usuario) => ({ usuario, body: { eventoId: evento.id, asientoIds: [asiento] } })),
      );

      const porCodigo = (codigo: number) => respuestas.filter((r) => r.status === codigo);
      expect(respuestas.map((r) => r.status).filter((s) => s !== 201 && s !== 409)).toEqual([]);
      expect(porCodigo(201)).toHaveLength(1);
      expect(porCodigo(409)).toHaveLength(49);
      for (const r of porCodigo(409)) {
        expect(r.body).toMatchObject({ codigo: 'ASIENTOS_NO_DISPONIBLES', noDisponibles: [asiento] });
      }

      // La BD es la que manda: 1 orden pendiente con ese asiento y el asiento apunta a ella.
      const ganadora = porCodigo(201)[0].body.ordenId;
      const pendientes = await prisma.orden.findMany({
        where: { eventoId: evento.id, estado: 'PENDIENTE_PAGO', items: { some: { asientoId: asiento } } },
        select: { id: true },
      });
      expect(pendientes).toEqual([{ id: ganadora }]);
      const fila = await prisma.asiento.findUniqueOrThrow({ where: { id: asiento } });
      expect(fila).toMatchObject({ estado: 'RESERVADO', ordenId: ganadora, version: 1 });
      expect(await prisma.ordenItem.count({ where: { asientoId: asiento } })).toBe(1);
    });
  });

  describe('C-06: Idempotency-Key', () => {
    it('20 peticiones concurrentes con la misma clave → 20 × 201 con el mismo ordenId y 1 sola orden', async () => {
      const evento = await eventoALaVenta();
      const [usuario] = await fx.crearCompradores(1);
      const clave = randomUUID();
      const body = { eventoId: evento.id, asientoIds: [evento.asientos[0], evento.asientos[1]] };

      const respuestas = await carrera(Array.from({ length: 20 }, () => ({ usuario, body, clave })));

      expect(respuestas.map((r) => r.status)).toEqual(Array(20).fill(201));
      expect(new Set(respuestas.map((r) => r.body.ordenId)).size).toBe(1);
      expect(await prisma.orden.count({ where: { usuarioId: usuario.id } })).toBe(1);
      expect(await prisma.ordenItem.count({ where: { ordenId: respuestas[0].body.ordenId } })).toBe(2);
    });

    it('un reintento secuencial devuelve exactamente el mismo cuerpo', async () => {
      const evento = await eventoALaVenta();
      const [usuario] = await fx.crearCompradores(1);
      const clave = randomUUID();
      // Mismos asientos en otro orden: es el mismo pedido.
      const primero = await reservar(
        usuario,
        { eventoId: evento.id, asientoIds: [evento.asientos[0], evento.asientos[1]] },
        clave,
      ).expect(201);

      const reintento = await reservar(
        usuario,
        { eventoId: evento.id, asientoIds: [evento.asientos[1], evento.asientos[0]] },
        clave,
      ).expect(201);

      expect(reintento.body).toEqual(primero.body);
      expect(await prisma.orden.count({ where: { usuarioId: usuario.id } })).toBe(1);
    });

    it('la misma clave con otros asientos → 422 IDEMPOTENCY_KEY_REUTILIZADA y no toca nada', async () => {
      const evento = await eventoALaVenta();
      const [usuario] = await fx.crearCompradores(1);
      const clave = randomUUID();
      await reservar(usuario, { eventoId: evento.id, asientoIds: [evento.asientos[0]] }, clave).expect(201);

      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: [evento.asientos[1]] }, clave).expect(422);

      expect(res.body.codigo).toBe('IDEMPOTENCY_KEY_REUTILIZADA');
      expect((await prisma.asiento.findUniqueOrThrow({ where: { id: evento.asientos[1] } })).estado).toBe('LIBRE');
    });

    it('la misma clave en otro evento → 422', async () => {
      const [evento, otro] = [await eventoALaVenta(), await eventoALaVenta()];
      const [usuario] = await fx.crearCompradores(1);
      const clave = randomUUID();
      await reservar(usuario, { eventoId: evento.id, asientoIds: [evento.asientos[0]] }, clave).expect(201);

      await reservar(usuario, { eventoId: otro.id, asientoIds: [otro.asientos[0]] }, clave).expect(422);
      expect(await prisma.orden.count({ where: { usuarioId: usuario.id } })).toBe(1);
    });

    it('la clave es por usuario: otro comprador con la misma clave tiene su propia orden', async () => {
      const evento = await eventoALaVenta();
      const [ana, beto] = await fx.crearCompradores(2);
      const clave = randomUUID();
      const deAna = await reservar(ana, { eventoId: evento.id, asientoIds: [evento.asientos[0]] }, clave).expect(201);

      const deBeto = await reservar(beto, { eventoId: evento.id, asientoIds: [evento.asientos[1]] }, clave).expect(201);

      expect(deBeto.body.ordenId).not.toBe(deAna.body.ordenId);
    });

    it('un 409 no se guarda: reintentar con la misma clave vuelve a intentar la reserva', async () => {
      const evento = await eventoALaVenta();
      const [ana, beto] = await fx.crearCompradores(2);
      const asiento = evento.asientos[0];
      const deAna = await reservar(ana, { eventoId: evento.id, asientoIds: [asiento] }).expect(201);
      const clave = randomUUID();
      await reservar(beto, { eventoId: evento.id, asientoIds: [asiento] }, clave).expect(409);

      // Ana pierde la reserva (simulado: la orden y el asiento vencen).
      await prisma.$executeRaw`UPDATE ordenes SET expires_at = now() - interval '1 second' WHERE id = ${deAna.body.ordenId}::uuid`;
      await prisma.$executeRaw`UPDATE asientos SET expires_at = now() - interval '1 second' WHERE id = ${asiento}::uuid`;

      await reservar(beto, { eventoId: evento.id, asientoIds: [asiento] }, clave).expect(201);
    });
  });

  describe('RN-09 y estado del evento', () => {
    // Fechas y estados forzados con Prisma: el DTO de POST /eventos no deja
    // crear un evento en el pasado.
    it.each([
      ['CANCELADO', { estado: 'CANCELADO' }, 'EVENTO_NO_DISPONIBLE'],
      ['FINALIZADO', { estado: 'FINALIZADO' }, 'EVENTO_NO_DISPONIBLE'],
      ['venta_inicio mañana', { ventaInicio: enDias(1) }, 'VENTA_NO_ABIERTA'],
      ['el evento ya empezó', { inicio: enDias(-0.5) }, 'VENTA_CERRADA'],
    ])('%s → 409 con su código y nada cambia', async (_caso, cambio, codigo) => {
      const evento = await eventoALaVenta(1, 1);
      await prisma.evento.update({ where: { id: evento.id }, data: cambio });
      const [usuario] = await fx.crearCompradores(1);

      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: evento.asientos }).expect(409);

      expect(res.body.codigo).toBe(codigo);
      expect(await prisma.orden.count({ where: { usuarioId: usuario.id } })).toBe(0);
      expect((await prisma.asiento.findUniqueOrThrow({ where: { id: evento.asientos[0] } })).estado).toBe('LIBRE');
    });
  });

  describe('contrato de POST /ordenes', () => {
    let evento: { id: string; asientos: string[] };
    let compradores: Usuario[];
    // Un comprador por caso: RN-04 no deja a uno tener dos órdenes pendientes en el evento.
    let siguiente = 0;
    const comprador = () => compradores[siguiente++];

    beforeAll(async () => {
      evento = await eventoALaVenta(4, 5);
      compradores = await fx.crearCompradores(15);
    });

    const ordenesDe = (usuario: Usuario) => prisma.orden.count({ where: { usuarioId: usuario.id } });

    it('201: orden PENDIENTE_PAGO, total en centavos, precio congelado y vence en RESERVA_TTL_SEGUNDOS', async () => {
      const usuario = comprador();
      const asientos = [evento.asientos[2], evento.asientos[0]];

      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: asientos, nit: '1234567' }).expect(201);

      expect(Object.keys(res.body).sort()).toEqual(
        ['asientoIds', 'estado', 'eventoId', 'expiresAt', 'moneda', 'ordenId', 'totalCentavos'].sort(),
      );
      expect(res.body).toMatchObject({
        eventoId: evento.id,
        estado: 'PENDIENTE_PAGO',
        asientoIds: [...asientos].sort(),
        totalCentavos: 2 * PRECIO,
        moneda: 'BOB',
      });
      expect(res.body.expiresAt).toMatch(/Z$/);

      // El vencimiento lo pone el reloj de Postgres, no el de la API.
      const orden = await prisma.orden.findUniqueOrThrow({ where: { id: res.body.ordenId }, include: { items: true } });
      const [{ ahora }] = await prisma.$queryRaw<{ ahora: Date }[]>`SELECT now() AS ahora`;
      const segundos = (orden.expiresAt.getTime() - ahora.getTime()) / 1000;
      expect(segundos).toBeGreaterThan(290);
      expect(segundos).toBeLessThanOrEqual(300);
      expect(orden).toMatchObject({ usuarioId: usuario.id, totalCentavos: BigInt(2 * PRECIO), nit: '1234567' });
      expect(orden.items.map((i) => i.precioCentavos)).toEqual([BigInt(PRECIO), BigInt(PRECIO)]);

      // Orden y asientos vencen en el mismo instante (mismo now() de la transacción).
      const filas = await prisma.asiento.findMany({ where: { id: { in: asientos } } });
      for (const a of filas) {
        expect(a).toMatchObject({ estado: 'RESERVADO', ordenId: orden.id, version: 1 });
        expect(a.expiresAt?.getTime()).toBe(orden.expiresAt.getTime());
      }
    });

    it('401: sin token', () => reservar(null, { eventoId: evento.id, asientoIds: [evento.asientos[3]] }).expect(401));

    it.each(['organizadorA', 'validador', 'admin'] as const)('403: %s no compra', async (rol) => {
      await reservar(fx.usuarios[rol], { eventoId: evento.id, asientoIds: [evento.asientos[3]] }).expect(403);
      expect(await ordenesDe(fx.usuarios[rol])).toBe(0);
    });

    it.each([
      ['sin Idempotency-Key', null],
      ['Idempotency-Key que no es UUID', 'reintento-1'],
    ])('400: %s', async (_caso, clave) => {
      const usuario = comprador();
      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: [evento.asientos[3]] }, clave).expect(400);
      expect(res.body.message).toBe('Falta el header Idempotency-Key o no es un UUID');
      expect(await ordenesDe(usuario)).toBe(0);
    });

    it.each([
      ['asientoIds vacío', () => ({ eventoId: evento.id, asientoIds: [] })],
      ['7 asientos (RN-03)', () => ({ eventoId: evento.id, asientoIds: evento.asientos.slice(10, 17) })],
      ['asientos repetidos', () => ({ eventoId: evento.id, asientoIds: [evento.asientos[3], evento.asientos[3]] })],
      ['un asiento que no es UUID', () => ({ eventoId: evento.id, asientoIds: ['F-12'] })],
      ['sin eventoId', () => ({ asientoIds: [evento.asientos[3]] })],
      ['totalCentavos del cliente', () => ({ eventoId: evento.id, asientoIds: [evento.asientos[3]], totalCentavos: 1 })],
    ])('400: %s', async (_caso, body) => {
      const usuario = comprador();
      await reservar(usuario, body()).expect(400);
      expect(await ordenesDe(usuario)).toBe(0);
    });

    it('404: evento inexistente', async () => {
      const res = await reservar(comprador(), { eventoId: randomUUID(), asientoIds: [randomUUID()] }).expect(404);
      expect(res.body.message).toBe('Evento no encontrado');
    });

    it('404: un BORRADOR da el mismo 404 (no se revela que existe)', async () => {
      const auth = `Bearer ${tokenDe(fx.usuarios.organizadorA)}`;
      const borrador = await request(url)
        .post('/eventos')
        .set('Authorization', auth)
        .send({
          titulo: `Borrador ${randomUUID().slice(0, 8)}`,
          recintoId: fx.recintoA.id,
          inicio: enDias(30).toISOString(),
          ventaInicio: enDias(-1).toISOString(),
          zona: { nombre: 'Platea', precioCentavos: PRECIO, filas: 1, columnas: 1 },
        })
        .expect(201);
      const asiento = await prisma.asiento.findFirstOrThrow({ where: { eventoId: borrador.body.id } });

      const res = await reservar(comprador(), { eventoId: borrador.body.id, asientoIds: [asiento.id] }).expect(404);
      expect(res.body.message).toBe('Evento no encontrado');
      expect((await prisma.asiento.findUniqueOrThrow({ where: { id: asiento.id } })).estado).toBe('LIBRE');
    });

    it('409: un asiento de otro evento cuenta como no disponible', async () => {
      const otro = await eventoALaVenta(1, 1);
      const usuario = comprador();
      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: [otro.asientos[0]] }).expect(409);
      expect(res.body).toMatchObject({ codigo: 'ASIENTOS_NO_DISPONIBLES', noDisponibles: [otro.asientos[0]] });
      expect(await ordenesDe(usuario)).toBe(0);
      expect((await prisma.asiento.findUniqueOrThrow({ where: { id: otro.asientos[0] } })).estado).toBe('LIBRE');
    });

    it('409: un asiento NO_DISPONIBLE (pasillo) no se reserva', async () => {
      const pasillo = evento.asientos[19];
      await prisma.asiento.update({ where: { id: pasillo }, data: { estado: 'NO_DISPONIBLE' } });
      await reservar(comprador(), { eventoId: evento.id, asientoIds: [pasillo] }).expect(409);
    });

    it('todo o nada (RN-03): {libre, ocupado} → 409 solo con el ocupado; el libre queda intacto y no hay orden', async () => {
      const [ocupado, libre] = [evento.asientos[5], evento.asientos[6]];
      await reservar(comprador(), { eventoId: evento.id, asientoIds: [ocupado] }).expect(201);

      const usuario = comprador();
      const res = await reservar(usuario, { eventoId: evento.id, asientoIds: [libre, ocupado] }).expect(409);

      // Solo QUÉ asiento falta: nada de a quién pertenece.
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        codigo: 'ASIENTOS_NO_DISPONIBLES',
        message: 'Algunos asientos ya no están disponibles',
        noDisponibles: [ocupado],
      });
      expect(await prisma.asiento.findUniqueOrThrow({ where: { id: libre } })).toMatchObject({
        estado: 'LIBRE',
        ordenId: null,
        version: 0,
      });
      expect(await ordenesDe(usuario)).toBe(0);
    });
  });
});
