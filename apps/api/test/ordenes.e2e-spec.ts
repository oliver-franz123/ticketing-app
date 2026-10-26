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
});
