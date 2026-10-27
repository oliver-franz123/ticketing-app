import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Rol } from '@entradas/db';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { InventarioService } from '../src/inventario/inventario.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearFixtures, enDias, enHoraBolivia, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';

// Contra el Postgres de docker compose (DATABASE_URL del .env de la raíz).
const levantarApp = async (ajustar?: (m: ReturnType<typeof Test.createTestingModule>) => void) => {
  process.env.JWT_SECRET = SECRETO;
  const builder = Test.createTestingModule({ imports: [AppModule] });
  ajustar?.(builder);
  const app = configurarApp((await builder.compile()).createNestApplication());
  await app.init();
  return app;
};

describe('Eventos y mapa de asientos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    app = await levantarApp();
    prisma = app.get(PrismaService);
    fx = await crearFixtures(prisma);
  });

  afterAll(async () => {
    await fx?.limpiar();
    await app.close();
  });

  // Título único por caso: así "no quedó nada en la BD" se puede contar sin ambigüedad.
  const cuerpo = (cambios: Record<string, unknown> = {}) => ({
    titulo: `Concierto ${randomUUID().slice(0, 8)}`,
    recintoId: fx.recintoA.id,
    inicio: enDias(30).toISOString(),
    ventaInicio: enDias(1).toISOString(),
    zona: { nombre: 'Platea', precioCentavos: 15050, filas: 5, columnas: 8 },
    ...cambios,
  });

  const crear = (usuario: { id: string; rol: Rol } | null, body: object) => {
    const req = request(app.getHttpServer()).post('/eventos').send(body);
    return usuario ? req.set('Authorization', `Bearer ${tokenDe(usuario)}`) : req;
  };

  const eventosConTitulo = (titulo: string) => prisma.evento.count({ where: { titulo } });

  // Todavía no hay endpoint de publicar: se crea por la API y el estado se cambia con Prisma.
  const crearConEstado = async (recintoId: string, dias: number, estado: string, zona?: object) => {
    const res = await crear(
      fx.usuarios.organizadorA,
      cuerpo({ recintoId, inicio: enDias(dias).toISOString(), ...(zona && { zona }) }),
    ).expect(201);
    await prisma.evento.update({ where: { id: res.body.id }, data: { estado } });
    return res.body as { id: string; titulo: string; zona: { id: string } };
  };

  describe('POST /eventos', () => {
    it('E-01: sin token → 401', () => crear(null, cuerpo()).expect(401));

    it.each(['comprador', 'validador'] as const)('E-01 (A-01): %s → 403 y no crea nada', async (rol) => {
      const body = cuerpo();
      await crear(fx.usuarios[rol], body).expect(403);
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it('E-02: ORGANIZADOR crea el evento BORRADOR con zona y grilla 5 × 8 LIBRE', async () => {
      const inicio = enDias(30);
      const body = cuerpo({ inicio: enHoraBolivia(inicio) });

      const res = await crear(fx.usuarios.organizadorA, body).expect(201);

      expect(res.body).toMatchObject({
        titulo: body.titulo,
        estado: 'BORRADOR',
        organizadorId: fx.usuarios.organizadorA.id,
        recintoId: fx.recintoA.id,
        inicio: inicio.toISOString(),
        zona: { nombre: 'Platea', precioCentavos: 15050, moneda: 'BOB' },
        totalAsientos: 40,
      });

      const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id }, include: { zonas: true } });
      expect(evento.organizadorId).toBe(fx.usuarios.organizadorA.id);
      expect(evento.estado).toBe('BORRADOR');
      // Mismo instante: se mandó con -04:00 y Postgres lo guarda en UTC.
      expect(evento.inicio.toISOString()).toBe(inicio.toISOString());
      expect(evento.zonas).toHaveLength(1);
      expect(evento.zonas[0].precioCentavos).toBe(15050n);

      const asientos = await prisma.asiento.findMany({ where: { eventoId: evento.id } });
      expect(asientos).toHaveLength(40);
      expect(new Set(asientos.map((a) => a.estado))).toEqual(new Set(['LIBRE']));
      expect(asientos.every((a) => a.zonaId === evento.zonas[0].id && a.ordenId === null && a.version === 0)).toBe(true);
      expect([...new Set(asientos.map((a) => a.fila))].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
      expect([...new Set(asientos.map((a) => a.columna))].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(new Set(asientos.map((a) => `${a.fila}-${a.columna}`)).size).toBe(40);
    });

    it('E-02: ORGANIZADOR con su propio organizadorId → 201', async () => {
      const res = await crear(fx.usuarios.organizadorA, cuerpo({ organizadorId: fx.usuarios.organizadorA.id })).expect(201);
      expect(res.body.organizadorId).toBe(fx.usuarios.organizadorA.id);
    });

    it('E-03: ORGANIZADOR A a nombre de B → 403 y no crea nada', async () => {
      const body = cuerpo({ organizadorId: fx.usuarios.organizadorB.id });
      await crear(fx.usuarios.organizadorA, body).expect(403);
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it('E-04: ADMIN a nombre del ORGANIZADOR B → 201 y el dueño es B', async () => {
      const res = await crear(fx.usuarios.admin, cuerpo({ organizadorId: fx.usuarios.organizadorB.id })).expect(201);
      expect(res.body.organizadorId).toBe(fx.usuarios.organizadorB.id);
      const evento = await prisma.evento.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(evento.organizadorId).toBe(fx.usuarios.organizadorB.id);
    });

    it('E-04: ADMIN sin organizadorId → el dueño es el ADMIN', async () => {
      const res = await crear(fx.usuarios.admin, cuerpo()).expect(201);
      expect(res.body.organizadorId).toBe(fx.usuarios.admin.id);
    });

    it.each([
      ['un COMPRADOR', () => fx.usuarios.comprador.id],
      ['un id inexistente', () => randomUUID()],
    ])('E-04: ADMIN a nombre de %s → 400 y no crea nada', async (_caso, id) => {
      const body = cuerpo({ organizadorId: id() });
      await crear(fx.usuarios.admin, body).expect(400);
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it('E-05: recinto inexistente → 400 y no crea nada', async () => {
      const body = cuerpo({ recintoId: randomUUID() });
      const res = await crear(fx.usuarios.organizadorA, body).expect(400);
      expect(res.body.message).toBe('El recinto no existe');
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it('E-06: 100 × 150 = 15.000 asientos (el límite) → 201 con 15.000 filas', async () => {
      const res = await crear(
        fx.usuarios.organizadorA,
        cuerpo({ zona: { nombre: 'General', precioCentavos: 5000, filas: 100, columnas: 150 } }),
      ).expect(201);
      expect(res.body.totalAsientos).toBe(15_000);
      expect(await prisma.asiento.count({ where: { eventoId: res.body.id } })).toBe(15_000);
      expect(await prisma.asiento.count({ where: { eventoId: res.body.id, fila: 'CV', columna: 150 } })).toBe(1);
    });

    it('E-06: 100 × 151 = 15.100 asientos → 400 sin tocar la BD', async () => {
      const body = cuerpo({ zona: { nombre: 'General', precioCentavos: 5000, filas: 100, columnas: 151 } });
      const res = await crear(fx.usuarios.organizadorA, body).expect(400);
      // Nest antepone la ruta del campo anidado.
      expect(res.body.message).toContain('zona.La zona no puede tener más de 15000 asientos (filas × columnas)');
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it.each([
      ['estado PUBLICADO', { estado: 'PUBLICADO' }],
      ['mapaVersion', { mapaVersion: 99 }],
    ])('E-08: campo no permitido (%s) → 400', async (_caso, extra) => {
      const body = cuerpo(extra);
      await crear(fx.usuarios.organizadorA, body).expect(400);
      expect(await eventosConTitulo(body.titulo)).toBe(0);
    });

    it.each([
      ['precio decimal', { zona: { nombre: 'Platea', precioCentavos: 150.5, filas: 1, columnas: 1 } }],
      ['fecha sin zona horaria', { inicio: enDias(30).toISOString().replace('Z', '') }],
    ])('E-08: %s → 400', async (_caso, cambio) => {
      await crear(fx.usuarios.organizadorA, cuerpo(cambio)).expect(400);
    });
  });

  describe('E-07: atomicidad de POST /eventos', () => {
    let appConFalla: INestApplication;

    beforeAll(async () => {
      // La grilla falla DESPUÉS de insertar evento y zona: el rollback tiene que borrar los dos.
      appConFalla = await levantarApp((m) =>
        m.overrideProvider(InventarioService).useValue({
          generarGrilla: () => Promise.reject(new Error('falla simulada al insertar la grilla')),
        }),
      );
    });

    afterAll(() => appConFalla.close());

    it('si falla la grilla → 500 y no queda ni evento ni zona', async () => {
      const body = cuerpo();
      await request(appConFalla.getHttpServer())
        .post('/eventos')
        .set('Authorization', `Bearer ${tokenDe(fx.usuarios.organizadorA)}`)
        .send(body)
        .expect(500);
      expect(await eventosConTitulo(body.titulo)).toBe(0);
      expect(await prisma.zona.count({ where: { evento: { titulo: body.titulo } } })).toBe(0);
    });
  });

  describe('GET /eventos', () => {
    // En la ciudad A: 3 PUBLICADOS desordenados por fecha, 1 CANCELADO y 1 BORRADOR.
    // En la ciudad B: 1 PUBLICADO. Los BORRADOR de los tests de POST también están en A.
    let a40: { id: string }, a20: { id: string }, a30: { id: string };
    let cancelado: { id: string }, borrador: { id: string }, enB: { id: string };

    beforeAll(async () => {
      a40 = await crearConEstado(fx.recintoA.id, 40, 'PUBLICADO');
      a20 = await crearConEstado(fx.recintoA.id, 20, 'PUBLICADO');
      a30 = await crearConEstado(fx.recintoA.id, 30, 'PUBLICADO');
      cancelado = await crearConEstado(fx.recintoA.id, 25, 'CANCELADO');
      borrador = await crearConEstado(fx.recintoA.id, 10, 'BORRADOR');
      enB = await crearConEstado(fx.recintoB.id, 15, 'PUBLICADO');
    });

    const listar = (query: Record<string, string | number>) => request(app.getHttpServer()).get('/eventos').query(query);
    const ids = (body: { items: { id: string }[] }) => body.items.map((e) => e.id);

    it('L-01: público (sin token), con caché de 30 s', async () => {
      const res = await listar({ ciudad: fx.ciudadA.slug }).expect(200);
      expect(res.headers['cache-control']).toBe('public, max-age=30');
    });

    it('L-02/L-04: solo PUBLICADOS de la ciudad pedida, ordenados por inicio', async () => {
      const res = await listar({ ciudad: fx.ciudadA.slug }).expect(200);
      expect(ids(res.body)).toEqual([a20.id, a30.id, a40.id]);
      expect(res.body).toMatchObject({ pagina: 1, porPagina: 20, total: 3 });
    });

    it('L-02: la otra ciudad no mezcla eventos', async () => {
      const res = await listar({ ciudad: fx.ciudadB.slug }).expect(200);
      expect(ids(res.body)).toContain(enB.id);
      expect(ids(res.body)).not.toContain(a20.id);
    });

    it('L-02: sin ?ciudad usa cochabamba, que no incluye las ciudades de test', async () => {
      const res = await listar({}).expect(200);
      expect(ids(res.body)).not.toContain(a20.id);
      expect(ids(res.body)).not.toContain(enB.id);
    });

    it('L-02: una ciudad desconocida devuelve lista vacía', async () => {
      const res = await listar({ ciudad: 'no-existe-esta-ciudad' }).expect(200);
      expect(res.body).toMatchObject({ items: [], total: 0 });
    });

    it('L-05: forma de cada item, con fechas en UTC (Z)', async () => {
      const res = await listar({ ciudad: fx.ciudadA.slug }).expect(200);
      const item = res.body.items[0];
      expect(Object.keys(item).sort()).toEqual(['ciudad', 'estado', 'id', 'inicio', 'recinto', 'titulo', 'ventaInicio']);
      expect(item.inicio).toMatch(/Z$/);
      expect(item.ventaInicio).toMatch(/Z$/);
      expect(item.recinto).toEqual({ id: fx.recintoA.id, nombre: fx.recintoA.nombre });
      expect(item.ciudad).toEqual({ slug: fx.ciudadA.slug, nombre: fx.ciudadA.nombre });
      expect(item.estado).toBe('PUBLICADO');
    });

    it('L-03: ?estado=CANCELADO lista solo los cancelados', async () => {
      const res = await listar({ ciudad: fx.ciudadA.slug, estado: 'CANCELADO' }).expect(200);
      expect(ids(res.body)).toEqual([cancelado.id]);
    });

    it('L-03: ?estado=BORRADOR → 400 (el público nunca ve borradores)', async () => {
      await listar({ ciudad: fx.ciudadA.slug, estado: 'BORRADOR' }).expect(400);
      const res = await listar({ ciudad: fx.ciudadA.slug }).expect(200);
      expect(ids(res.body)).not.toContain(borrador.id);
    });

    it('L-04: paginación de 2 en 2', async () => {
      const p1 = await listar({ ciudad: fx.ciudadA.slug, porPagina: 2, pagina: 1 }).expect(200);
      expect(ids(p1.body)).toEqual([a20.id, a30.id]);
      expect(p1.body).toMatchObject({ pagina: 1, porPagina: 2, total: 3 });

      const p2 = await listar({ ciudad: fx.ciudadA.slug, porPagina: 2, pagina: 2 }).expect(200);
      expect(ids(p2.body)).toEqual([a40.id]);
      expect(p2.body.total).toBe(3);
    });

    it.each([
      ['porPagina=51', { porPagina: 51 }],
      ['porPagina=0', { porPagina: 0 }],
      ['pagina=0', { pagina: 0 }],
      ['pagina=abc', { pagina: 'abc' }],
      ['parámetro desconocido', { orden: 'desc' }],
    ])('L-05: %s → 400', async (_caso, query) => {
      await listar({ ciudad: fx.ciudadA.slug, ...query }).expect(400);
    });
  });

  describe('GET /recintos', () => {
    it('público, solo los recintos de la ciudad pedida', async () => {
      const res = await request(app.getHttpServer()).get('/recintos').query({ ciudad: fx.ciudadA.slug }).expect(200);
      expect(res.body.items).toEqual([
        {
          id: fx.recintoA.id,
          nombre: 'Coliseo A',
          direccion: 'Av. de prueba',
          ciudad: { slug: fx.ciudadA.slug, nombre: 'Quillacollo' },
        },
      ]);
    });

    it('una ciudad inexistente da una lista vacía', async () => {
      const res = await request(app.getHttpServer()).get('/recintos').query({ ciudad: 'no-existe' }).expect(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('GET /eventos/:id/asientos', () => {
    // En la ciudad B para no alterar los conteos del listado de A.
    // 27 filas: prueba que AA va después de Z (orden por texto pondría AA antes de B).
    let publicado: { id: string; zona: { id: string } };
    let borrador: { id: string };

    beforeAll(async () => {
      const zona = { nombre: 'Platea', precioCentavos: 15050, filas: 27, columnas: 2 };
      publicado = await crearConEstado(fx.recintoB.id, 50, 'PUBLICADO', zona);
      borrador = await crearConEstado(fx.recintoB.id, 50, 'BORRADOR');
    });

    const mapa = (id: string) => request(app.getHttpServer()).get(`/eventos/${id}/asientos`);
    const NO_ENCONTRADO = { statusCode: 404, message: 'Evento no encontrado', error: 'Not Found' };

    it('M-01: público (sin token), con zonas, versión y todos los asientos LIBRE', async () => {
      const res = await mapa(publicado.id).expect(200);

      expect(res.body.eventoId).toBe(publicado.id);
      expect(res.body.version).toBe(0);
      expect(res.body.zonas).toEqual([{ id: publicado.zona.id, nombre: 'Platea', precioCentavos: 15050, moneda: 'BOB' }]);
      expect(res.body.asientos).toHaveLength(54);
      expect(Object.keys(res.body.asientos[0]).sort()).toEqual(['columna', 'estado', 'fila', 'id', 'zonaId']);
      expect(res.body.asientos.every((a: { estado: string }) => a.estado === 'LIBRE')).toBe(true);
    });

    it('M-01: orden A1, A2, B1… Z2, AA1, AA2', async () => {
      const res = await mapa(publicado.id).expect(200);
      const etiquetas = res.body.asientos.map((a: { fila: string; columna: number }) => `${a.fila}${a.columna}`);
      expect(etiquetas.slice(0, 3)).toEqual(['A1', 'A2', 'B1']);
      expect(etiquetas.slice(-4)).toEqual(['Z1', 'Z2', 'AA1', 'AA2']);
    });

    it('M-02: un BORRADOR da el mismo 404 que un evento inexistente', async () => {
      await mapa(borrador.id).expect(404).expect(NO_ENCONTRADO);
      await mapa(randomUUID()).expect(404).expect(NO_ENCONTRADO);
    });

    it('M-02: id que no es uuid → 400', () => mapa('42').expect(400));

    it('M-03: un asiento NO_DISPONIBLE (forzado por SQL) aparece así en el mapa', async () => {
      await prisma.$executeRaw`
        UPDATE asientos SET estado = 'NO_DISPONIBLE'
        WHERE evento_id = ${publicado.id}::uuid AND fila = 'B' AND columna = 2`;

      const res = await mapa(publicado.id).expect(200);
      const b2 = res.body.asientos.find((a: { fila: string; columna: number }) => a.fila === 'B' && a.columna === 2);
      expect(b2.estado).toBe('NO_DISPONIBLE');
      expect(res.body.asientos.filter((a: { estado: string }) => a.estado === 'LIBRE')).toHaveLength(53);
    });
  });

  describe('PATCH /eventos/:id/publicar', () => {
    // En la ciudad B para no alterar los conteos del listado de A.
    const borradorEnB = () => crearConEstado(fx.recintoB.id, 60, 'BORRADOR');

    const publicar = (usuario: { id: string; rol: Rol } | null, id: string) => {
      const req = request(app.getHttpServer()).patch(`/eventos/${id}/publicar`);
      return usuario ? req.set('Authorization', `Bearer ${tokenDe(usuario)}`) : req;
    };

    const estadoDe = async (id: string) => (await prisma.evento.findUniqueOrThrow({ where: { id } })).estado;

    it('E-09: sin token → 401 y sigue BORRADOR', async () => {
      const evento = await borradorEnB();
      await publicar(null, evento.id).expect(401);
      expect(await estadoDe(evento.id)).toBe('BORRADOR');
    });

    it.each(['comprador', 'validador'] as const)('E-09: %s → 403 y sigue BORRADOR', async (rol) => {
      const evento = await borradorEnB();
      await publicar(fx.usuarios[rol], evento.id).expect(403);
      expect(await estadoDe(evento.id)).toBe('BORRADOR');
    });

    it('E-10: el ORGANIZADOR dueño publica → 200 y el mapa pasa a ser público', async () => {
      const evento = await borradorEnB();
      await request(app.getHttpServer()).get(`/eventos/${evento.id}/asientos`).expect(404);

      const res = await publicar(fx.usuarios.organizadorA, evento.id).expect(200);

      expect(res.body).toEqual({ id: evento.id, estado: 'PUBLICADO' });
      expect(await estadoDe(evento.id)).toBe('PUBLICADO');
      await request(app.getHttpServer()).get(`/eventos/${evento.id}/asientos`).expect(200);
    });

    it('E-11: un ADMIN publica el evento de otro organizador → 200', async () => {
      const evento = await borradorEnB();
      await publicar(fx.usuarios.admin, evento.id).expect(200);
      expect(await estadoDe(evento.id)).toBe('PUBLICADO');
    });

    it('E-12: el ORGANIZADOR B publica el evento de A → el mismo 404 que un id inexistente', async () => {
      const evento = await borradorEnB();
      const ajeno = await publicar(fx.usuarios.organizadorB, evento.id).expect(404);
      const inexistente = await publicar(fx.usuarios.organizadorB, randomUUID()).expect(404);
      expect(ajeno.body).toEqual(inexistente.body);
      expect(await estadoDe(evento.id)).toBe('BORRADOR');
    });

    it('E-12: id que no es uuid → 400', () => publicar(fx.usuarios.organizadorA, '42').expect(400));

    it('E-13: publicar dos veces → 409 y no hay vuelta atrás', async () => {
      const evento = await borradorEnB();
      await publicar(fx.usuarios.organizadorA, evento.id).expect(200);
      const res = await publicar(fx.usuarios.organizadorA, evento.id).expect(409);
      expect(res.body.message).toBe('El evento ya no está en BORRADOR');
      expect(await estadoDe(evento.id)).toBe('PUBLICADO');
    });

    it('E-13: dos PATCH concurrentes → exactamente un 200 y un 409', async () => {
      const evento = await borradorEnB();
      const codigos = (
        await Promise.all([publicar(fx.usuarios.organizadorA, evento.id), publicar(fx.usuarios.admin, evento.id)])
      ).map((r) => r.status);
      expect(codigos.sort()).toEqual([200, 409]);
    });

    it('E-13: un CANCELADO no se puede publicar → 409', async () => {
      const evento = await crearConEstado(fx.recintoB.id, 60, 'CANCELADO');
      await publicar(fx.usuarios.organizadorA, evento.id).expect(409);
      expect(await estadoDe(evento.id)).toBe('CANCELADO');
    });
  });
});
