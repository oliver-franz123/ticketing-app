import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configurarApp } from '../src/configurar-app';
import { SaludController } from '../src/salud/salud.controller';

const PERMITIDO = 'https://entradas.vercel.app';

// Solo /health: CORS no depende de la BD ni de auth.
describe('CORS desde CORS_ORIGINS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = `${PERMITIDO}, http://localhost:3001`;
    const modulo = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      controllers: [SaludController],
    }).compile();
    app = configurarApp(modulo.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    delete process.env.CORS_ORIGINS;
    await app.close();
  });

  const preflight = (origen: string) =>
    request(app.getHttpServer())
      .options('/health')
      .set('Origin', origen)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,idempotency-key');

  it('un origen permitido recibe las cabeceras CORS en el preflight', async () => {
    const res = await preflight(PERMITIDO).expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(PERMITIDO);
    expect(res.headers['access-control-allow-headers']).toBe('Authorization,Content-Type,Idempotency-Key');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('un origen no listado no recibe Access-Control-Allow-Origin', async () => {
    const res = await preflight('https://malicioso.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('GET /health desde el origen permitido devuelve la cabecera', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('Origin', PERMITIDO).expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(PERMITIDO);
    expect(res.body).toEqual({ estado: 'ok' });
  });
});
