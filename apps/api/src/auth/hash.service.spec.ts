import { HashService } from './hash.service';

describe('HashService', () => {
  const servicio = new HashService();
  beforeAll(() => servicio.onModuleInit());

  it('usa argon2id con los parámetros mínimos de OWASP (19 MiB, t=2, p=1)', async () => {
    const [, tipo, version, parametros] = (await servicio.hashear('una-clave-larga')).split('$');
    expect([tipo, version]).toEqual(['argon2id', 'v=19']);
    // El orden de los parámetros en el string depende de la versión de la librería.
    expect(parametros.split(',').sort()).toEqual(['m=19456', 'p=1', 't=2']);
  });

  it('verifica la contraseña correcta y rechaza otra', async () => {
    const hash = await servicio.hashear('una-clave-larga');
    await expect(servicio.verificar(hash, 'una-clave-larga')).resolves.toBe(true);
    await expect(servicio.verificar(hash, 'otra-clave')).resolves.toBe(false);
  });

  it('el señuelo siempre da false (se usa cuando el email no existe)', async () => {
    await expect(servicio.verificarSenuelo('cualquier-cosa')).resolves.toBe(false);
  });
});
