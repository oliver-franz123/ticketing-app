import { HashService } from './hash.service';

describe('HashService', () => {
  const servicio = new HashService();
  beforeAll(() => servicio.onModuleInit());

  it('usa argon2id con los parámetros mínimos de OWASP (19 MiB, t=2, p=1)', async () => {
    const hash = await servicio.hashear('una-clave-larga');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
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
