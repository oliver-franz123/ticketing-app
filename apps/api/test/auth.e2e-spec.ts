import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';

// Contra el Postgres de docker compose (DATABASE_URL del .env de la raíz).
const DOMINIO = '@t9.test.local';
const email = () => `t9-${randomUUID().slice(0, 8)}${DOMINIO}`;
const payloadDe = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

const CREDENCIALES_INVALIDAS = { statusCode: 401, message: 'Email o contraseña incorrectos', error: 'Unauthorized' };

describe('POST /auth/registro y /auth/login', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const limpiar = () => prisma.usuario.deleteMany({ where: { email: { endsWith: DOMINIO } } });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'secreto-de-prueba-de-al-menos-32-bytes!!';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await app.close();
  });

  const registrar = (cuerpo: object) => request(app.getHttpServer()).post('/auth/registro').send(cuerpo);
  const login = (cuerpo: object) => request(app.getHttpServer()).post('/auth/login').send(cuerpo);

  describe('registro', () => {
    it('201 con token de COMPRADOR, sin datos personales en el payload', async () => {
      const correo = email();
      const res = await registrar({ email: correo, password: '12345678', nombre: 'Ana' }).expect(201);

      const payload = payloadDe(res.body.token);
      expect(Object.keys(res.body)).toEqual(['token']);
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'rol', 'sub']);
      expect(payload.rol).toBe('COMPRADOR');

      const fila = await prisma.usuario.findUniqueOrThrow({ where: { email: correo } });
      expect(fila.id).toBe(payload.sub);
      expect(fila.rol).toBe('COMPRADOR');
      expect(fila.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('acepta teléfono +591', () =>
      registrar({ email: email(), password: '12345678', nombre: 'Beto', telefono: '+59170012345' }).expect(201));

    it.each([
      ['rol en el body (no se puede elegir rol)', { rol: 'ADMIN' }],
      ['contraseña de 7 caracteres', { password: '1234567' }],
      ['email inválido', { email: 'no-es-email' }],
      ['nombre vacío', { nombre: '   ' }],
      ['teléfono sin +591', { telefono: '70012345' }],
    ])('400: %s', async (_caso, cambio) => {
      const correo = email();
      await registrar({ email: correo, password: '12345678', nombre: 'Ana', ...cambio }).expect(400);
      expect(await prisma.usuario.count({ where: { email: correo } })).toBe(0);
    });

    it('email repetido (otras mayúsculas) → 409 genérico, sin revelar el campo', async () => {
      const correo = email();
      await registrar({ email: correo, password: '12345678', nombre: 'Ana' }).expect(201);
      const res = await registrar({ email: correo.toUpperCase(), password: '87654321', nombre: 'Otra' }).expect(409);
      expect(res.body).toEqual({ statusCode: 409, message: 'No se pudo completar el registro', error: 'Conflict' });
    });
  });

  describe('login', () => {
    const correo = email();
    let id: string;

    beforeAll(async () => {
      const res = await registrar({ email: correo, password: 'clave-correcta', nombre: 'Caro' }).expect(201);
      id = payloadDe(res.body.token).sub;
    });

    it('200 con token (email sin distinguir mayúsculas)', async () => {
      const res = await login({ email: correo.toUpperCase(), password: 'clave-correcta' }).expect(200);
      expect(payloadDe(res.body.token)).toMatchObject({ sub: id, rol: 'COMPRADOR' });
    });

    it('contraseña incorrecta y email inexistente → el mismo 401', async () => {
      const malaClave = await login({ email: correo, password: 'clave-incorrecta' }).expect(401);
      const noExiste = await login({ email: email(), password: 'clave-incorrecta' }).expect(401);
      expect(malaClave.body).toEqual(CREDENCIALES_INVALIDAS);
      expect(noExiste.body).toEqual(malaClave.body);
    });

    it('cuerpo incompleto → 400', () => login({ email: correo }).expect(400));
  });
});
