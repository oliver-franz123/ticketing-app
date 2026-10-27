import { simuladorHabilitado } from './habilitado';

// El caso que importa es "ausente": un despliegue sin la variable no puede
// tener el simulador (un e2e no lo prueba en local, porque ConfigModule la
// vuelve a cargar desde el .env).
describe('simuladorHabilitado', () => {
  it.each([
    ['ausente', undefined],
    ['"false"', 'false'],
    ['"TRUE"', 'TRUE'],
    ['" true " (con espacios)', ' true '],
    ['vacía', ''],
  ])('%s → no se monta', (_caso, valor) => {
    expect(simuladorHabilitado(valor === undefined ? {} : { SIMULADOR_HABILITADO: valor })).toBe(false);
  });

  it('"true" → se monta', () => {
    expect(simuladorHabilitado({ SIMULADOR_HABILITADO: 'true' })).toBe(true);
  });
});
