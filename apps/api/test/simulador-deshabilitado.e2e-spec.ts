import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SECRETO_SIMULADOR } from './firma-simulador-prueba';
import { SECRETO } from './fixtures-eventos';

// Con SIMULADOR_HABILITADO=false el módulo SimuladorPagos no existe (ADR-0015):
// su "API de proveedor" da 404, como cualquier ruta inexistente.
//
// Archivo aparte e import dinámico: ConditionalModule decide UNA vez, cuando se
// evalúa el decorador de AppModule. Vitest aísla cada archivo, así que aquí
// AppModule se importa por primera vez después de fijar la variable. dotenv no
// pisa una variable que ya existe, así que el .env no la cambia.
describe('Simulador deshabilitado', () => {
  let app: INestApplication;
  const anterior = process.env.SIMULADOR_HABILITADO;

  beforeAll(async () => {
    process.env.SIMULADOR_HABILITADO = 'false';
    process.env.JWT_SECRET = SECRETO;
    process.env.SIMULADOR_WEBHOOK_SECRET = SECRETO_SIMULADOR;
    const { AppModule } = await import('../src/app.module.js');
    const { configurarApp } = await import('../src/configurar-app.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication({ rawBody: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env.SIMULADOR_HABILITADO = anterior;
  });

  it('POST /simulador/pagos → 404 y el resto de la API sigue arriba', async () => {
    await request(app.getHttpServer())
      .post('/simulador/pagos')
      .send({ ordenId: '00000000-0000-4000-8000-000000000000', montoCentavos: 100, moneda: 'BOB' })
      .expect(404);
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
