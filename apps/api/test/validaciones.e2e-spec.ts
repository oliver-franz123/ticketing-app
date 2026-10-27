import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Rol } from '@entradas/db';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearFixtures, enDias, type Fixtures, SECRETO, tokenDe } from './fixtures-eventos';
import { firmarQrPrueba, parQrDePrueba } from './qr-prueba';

// Validación en puerta (doc 04, doc 05 §9, ADR-0011) contra el Postgres real.
// La marca USADA es un CAS: UPDATE ... WHERE estado = 'EMITIDA'. Sin mocks de la
// BD: un mock no re-evalúa el WHERE después de esperar el lock (doc 10 §1).
type Usuario = { id: string; rol: Rol };
type Resultado = { resultado: string; usadaEn?: string };

describe('Validaciones: POST /validaciones', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fx: Fixtures;
  const par = parQrDePrueba();

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    // La API solo tiene la pública (ADR-0011); la privada queda en el test.
    process.env.QR_SIGNING_PUBLIC_KEY = par.publicaBase64;
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication());
    // Un solo listen, como en ordenes.e2e-spec: las peticiones de la carrera
    // salen juntas por sockets ya abiertos.
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    fx = await crearFixtures(prisma);
  });

  afterAll(async () => {
    await fx?.limpiar();
    await app.close();
  });

  // Evento publicado + una orden PAGADA con su entrada EMITIDA. La reserva va por
  // la API; el pago se aplica con Prisma, igual que lo deja el webhook (asiento
  // VENDIDO, orden PAGADA, entrada EMITIDA), porque aquí se prueba la puerta, no el pago.
  const entradaEmitida = async () => {
    const auth = `Bearer ${tokenDe(fx.usuarios.organizadorA)}`;
    const evento = await request(url)
      .post('/eventos')
      .set('Authorization', auth)
      .send({
        titulo: `Puerta ${randomUUID().slice(0, 8)}`,
        recintoId: fx.recintoA.id,
        inicio: enDias(30).toISOString(),
        ventaInicio: enDias(-1).toISOString(),
        zona: { nombre: 'Platea', precioCentavos: 5000, filas: 1, columnas: 2 },
      })
      .expect(201);
    await request(url).patch(`/eventos/${evento.body.id}/publicar`).set('Authorization', auth).expect(200);
    const asiento = await prisma.asiento.findFirstOrThrow({ where: { eventoId: evento.body.id, columna: 1 } });
    const orden = await request(url)
      .post('/ordenes')
      .set('Authorization', `Bearer ${tokenDe(fx.usuarios.comprador)}`)
      .set('Idempotency-Key', randomUUID())
      .send({ eventoId: evento.body.id, asientoIds: [asiento.id] })
      .expect(201);

    const entrada = await prisma.$transaction(async (tx) => {
      await tx.orden.update({ where: { id: orden.body.ordenId }, data: { estado: 'PAGADA' } });
      await tx.asiento.update({ where: { id: asiento.id }, data: { estado: 'VENDIDO', expiresAt: null } });
      return tx.entrada.create({ data: { ordenId: orden.body.ordenId, asientoId: asiento.id } });
    });
    const qr = firmarQrPrueba(
      { t: entrada.id, e: evento.body.id, i: Math.floor(entrada.emitidaEn.getTime() / 1000) },
      par.privada,
    );
    return { eventoId: evento.body.id as string, entradaId: entrada.id, qr };
  };

  const validar = (usuario: Usuario | null, body: object) => {
    const req = request(url).post('/validaciones').send(body);
    return usuario ? req.set('Authorization', `Bearer ${tokenDe(usuario)}`) : req;
  };

  describe('A-06: la carrera en la puerta', () => {
    it('10 escaneos simultáneos del mismo QR → exactamente 1 VALIDA y 9 YA_USADA', async () => {
      const { eventoId, entradaId, qr } = await entradaEmitida();
      // Calentar: sockets keep-alive abiertos y el pool de Postgres lleno, para
      // que las 10 transacciones compitan de verdad (ver calentar() en ordenes.e2e-spec).
      await Promise.all([
        ...Array.from({ length: 10 }, () => fetch(`${url}/health`).then((r) => r.text())),
        ...Array.from({ length: 10 }, () => prisma.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(0.05)`)),
      ]);

      const pedido = {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenDe(fx.usuarios.validador)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr, eventoId }),
      };
      const respuestas = await Promise.all(
        Array.from({ length: 10 }, async () => {
          const r = await fetch(`${url}/validaciones`, pedido);
          return { status: r.status, body: (await r.json()) as Resultado };
        }),
      );

      expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(200));
      const resultados = respuestas.map((r) => r.body.resultado).sort();
      expect(resultados).toEqual(['VALIDA', ...Array(9).fill('YA_USADA')]);

      // Los 9 rechazos informan cuándo se usó: el mismo instante que quedó en la BD.
      const entrada = await prisma.entrada.findUniqueOrThrow({ where: { id: entradaId } });
      expect(entrada).toMatchObject({ estado: 'USADA', usadaPor: fx.usuarios.validador.id });
      for (const r of respuestas.filter((x) => x.body.resultado === 'YA_USADA')) {
        expect(new Date(r.body.usadaEn!).getTime()).toBe(entrada.usadaEn!.getTime());
      }

      // Cada intento queda registrado, también los rechazados.
      const registro = await prisma.validacion.groupBy({
        by: ['resultado'],
        where: { entradaId },
        _count: true,
        orderBy: { resultado: 'asc' },
      });
      expect(registro.map((g) => [g.resultado, g._count])).toEqual([
        ['VALIDA', 1],
        ['YA_USADA', 9],
      ]);
    });
  });

  describe('resultados', () => {
    const registros = (entradaId: string | null, validadorId: string) =>
      prisma.validacion.findMany({ where: { entradaId, validadorId }, select: { resultado: true } });

    it('VALIDA la primera vez y YA_USADA con usadaEn la segunda', async () => {
      const { eventoId, qr } = await entradaEmitida();
      await validar(fx.usuarios.validador, { qr, eventoId }).expect(200, { resultado: 'VALIDA' });
      const res = await validar(fx.usuarios.validador, { qr, eventoId }).expect(200);
      expect(res.body).toEqual({ resultado: 'YA_USADA', usadaEn: expect.any(String) });
    });

    it('A-05: payload alterado (otro t) → INVALIDA con entrada_id NULL y la entrada sigue EMITIDA', async () => {
      const { eventoId, entradaId, qr } = await entradaEmitida();
      const [prefijo, payload, firma] = qr.split('.');
      const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const alterado = Buffer.from(JSON.stringify({ ...datos, t: randomUUID() })).toString('base64url');
      const antes = await registros(null, fx.usuarios.admin.id);

      await validar(fx.usuarios.admin, { qr: `${prefijo}.${alterado}.${firma}`, eventoId }).expect(200, {
        resultado: 'INVALIDA',
      });
      expect(await registros(null, fx.usuarios.admin.id)).toHaveLength(antes.length + 1);
      expect((await prisma.entrada.findUniqueOrThrow({ where: { id: entradaId } })).estado).toBe('EMITIDA');
    });

    it('firmado con otra clave → INVALIDA', async () => {
      const { eventoId, entradaId } = await entradaEmitida();
      const otra = parQrDePrueba();
      const qr = firmarQrPrueba({ t: entradaId, e: eventoId, i: 0 }, otra.privada);
      await validar(fx.usuarios.validador, { qr, eventoId }).expect(200, { resultado: 'INVALIDA' });
    });

    it.each([['texto cualquiera'], ['TKT1.abc.def'], ['TKT2.e30.AAAA']])('formato malo (%s) → INVALIDA', async (qr) => {
      await validar(fx.usuarios.validador, { qr, eventoId: randomUUID() }).expect(200, { resultado: 'INVALIDA' });
    });

    it('firma válida de una entrada que no existe → INVALIDA con entrada_id NULL', async () => {
      const qr = firmarQrPrueba({ t: randomUUID(), e: randomUUID(), i: 0 }, par.privada);
      await validar(fx.usuarios.validador, { qr, eventoId: randomUUID() }).expect(200, { resultado: 'INVALIDA' });
    });

    it('A-03: QR de otro evento → OTRO_EVENTO, registrado con su entrada, y no la marca', async () => {
      const { entradaId, qr } = await entradaEmitida();
      const otro = await entradaEmitida();
      await validar(fx.usuarios.validador, { qr, eventoId: otro.eventoId }).expect(200, { resultado: 'OTRO_EVENTO' });
      expect(await registros(entradaId, fx.usuarios.validador.id)).toEqual([{ resultado: 'OTRO_EVENTO' }]);
      expect((await prisma.entrada.findUniqueOrThrow({ where: { id: entradaId } })).estado).toBe('EMITIDA');
    });

    it('entrada ANULADA → INVALIDA', async () => {
      const { eventoId, entradaId, qr } = await entradaEmitida();
      await prisma.entrada.update({ where: { id: entradaId }, data: { estado: 'ANULADA' } });
      await validar(fx.usuarios.validador, { qr, eventoId }).expect(200, { resultado: 'INVALIDA' });
    });
  });

  describe('acceso y contrato', () => {
    it('401 sin token', () => validar(null, { qr: 'x', eventoId: randomUUID() }).expect(401));

    it.each([['comprador'], ['organizadorA']] as const)('403 como %s', (rol) =>
      validar(fx.usuarios[rol], { qr: 'x', eventoId: randomUUID() }).expect(403),
    );

    it.each([
      ['sin eventoId', { qr: 'x' }],
      ['eventoId que no es UUID', { qr: 'x', eventoId: '42' }],
      ['qr de más de 1 KB', { qr: 'x'.repeat(1025), eventoId: randomUUID() }],
    ])('400: %s', (_caso, body) => validar(fx.usuarios.validador, body).expect(400));
  });
});
