import { Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { Publico, Roles, UsuarioActual } from '../src/auth/decoradores';
import type { UsuarioAutenticado } from '../src/auth/tipos';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ahora, firmarHs256, sinFirma } from './jwt-prueba';

const SECRETO = 'secreto-de-prueba-de-al-menos-32-bytes!!';
const ID = '6f1c1a52-6a3b-4b8e-9a51-0c2d6c2b9e11';

// Controlador solo de test: prueba el guard aislado de la lógica de negocio.
// A-01 contra el controlador real (POST /eventos) está en eventos.e2e-spec.ts (E-01).
@Controller()
class ControladorPrueba {
  @Publico()
  @Get('publico')
  publico() {
    return { ok: true };
  }

  // Sin @Roles a propósito: cualquier usuario autenticado puede ver su sesión.
  @Get('privado')
  privado(@UsuarioActual() usuario: UsuarioAutenticado) {
    return usuario;
  }

  @Roles('ORGANIZADOR', 'ADMIN')
  @Post('con-roles')
  @HttpCode(201)
  conRoles() {
    return { creado: true };
  }
}

const token = (payload: object, secreto = SECRETO) =>
  firmarHs256({ iat: ahora(), exp: ahora() + 3600, ...payload }, secreto);

const NO_AUTENTICADO = { statusCode: 401, message: 'No autenticado', error: 'Unauthorized' };

describe('Guards de auth (@Roles, A-04)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRETO;
    process.env.JWT_EXPIRES_IN = '60m';
    const modulo = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule],
      controllers: [ControladorPrueba],
    })
      // Los guards no tocan la BD: el rol viaja en el token.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('un endpoint @Publico responde sin token', () =>
    request(app.getHttpServer()).get('/publico').expect(200));

  it('sin token → 401', () =>
    request(app.getHttpServer()).get('/privado').expect(401).expect(NO_AUTENTICADO));

  it('con token válido → 200 y expone solo id y rol', () =>
    request(app.getHttpServer())
      .get('/privado')
      .set('Authorization', `Bearer ${token({ sub: ID, rol: 'COMPRADOR' })}`)
      .expect(200)
      .expect({ id: ID, rol: 'COMPRADOR' }));

  describe('A-04: JWT inválido → 401', () => {
    const casos: Array<[string, () => string]> = [
      ['vencido', () => firmarHs256({ sub: ID, rol: 'COMPRADOR', iat: ahora() - 7200, exp: ahora() - 10 }, SECRETO)],
      [
        'payload alterado (rol subido a ADMIN, firma original)',
        () => {
          const [h, , f] = token({ sub: ID, rol: 'COMPRADOR' }).split('.');
          const p = Buffer.from(JSON.stringify({ sub: ID, rol: 'ADMIN', iat: ahora(), exp: ahora() + 3600 })).toString('base64url');
          return `${h}.${p}.${f}`;
        },
      ],
      [
        'firma alterada',
        () => {
          const t = token({ sub: ID, rol: 'COMPRADOR' });
          // Se cambia un carácter del medio: el último puede llevar bits de relleno.
          const i = t.lastIndexOf('.') + 10;
          return t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);
        },
      ],
      ['firmado con otra clave', () => token({ sub: ID, rol: 'COMPRADOR' }, 'otra-clave-distinta-de-32-bytes-o-mas!!')],
      ['alg none', () => sinFirma({ sub: ID, rol: 'ADMIN', iat: ahora(), exp: ahora() + 3600 })],
      ['malformado', () => 'esto-no-es-un-jwt'],
      ['rol desconocido', () => token({ sub: ID, rol: 'SUPERUSUARIO' })],
      ['sin sub', () => token({ rol: 'COMPRADOR' })],
    ];

    it.each(casos)('%s', async (_nombre, generar) => {
      await request(app.getHttpServer())
        .get('/privado')
        .set('Authorization', `Bearer ${generar()}`)
        .expect(401)
        .expect(NO_AUTENTICADO);
    });

    it('esquema distinto de Bearer', () =>
      request(app.getHttpServer())
        .get('/privado')
        .set('Authorization', `Basic ${token({ sub: ID, rol: 'COMPRADOR' })}`)
        .expect(401)
        .expect(NO_AUTENTICADO));
  });

  describe('@Roles: rol insuficiente → 403', () => {
    it('COMPRADOR → 403', () =>
      request(app.getHttpServer())
        .post('/con-roles')
        .set('Authorization', `Bearer ${token({ sub: ID, rol: 'COMPRADOR' })}`)
        .expect(403)
        .expect({ statusCode: 403, message: 'No tiene permiso para esta acción', error: 'Forbidden' }));

    it('VALIDADOR → 403', () =>
      request(app.getHttpServer())
        .post('/con-roles')
        .set('Authorization', `Bearer ${token({ sub: ID, rol: 'VALIDADOR' })}`)
        .expect(403));

    it.each(['ORGANIZADOR', 'ADMIN'])('%s → 201', async (rol) => {
      await request(app.getHttpServer())
        .post('/con-roles')
        .set('Authorization', `Bearer ${token({ sub: ID, rol })}`)
        .expect(201);
    });

    it('sin token en un endpoint con @Roles → 401 (no 403)', () =>
      request(app.getHttpServer()).post('/con-roles').expect(401));
  });
});
