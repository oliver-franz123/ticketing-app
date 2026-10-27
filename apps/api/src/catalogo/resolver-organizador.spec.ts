import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@entradas/db';
import { resolverOrganizador } from './resolver-organizador';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('resolverOrganizador', () => {
  const organizador = { id: ORG_A, rol: Rol.ORGANIZADOR };
  const admin = { id: ADMIN, rol: Rol.ADMIN };

  it('ORGANIZADOR sin organizadorId → él mismo, sin verificar en BD', () => {
    expect(resolverOrganizador(organizador)).toEqual({ organizadorId: ORG_A, verificarRol: false });
  });

  it('ORGANIZADOR con su propio id → él mismo', () => {
    expect(resolverOrganizador(organizador, ORG_A)).toEqual({ organizadorId: ORG_A, verificarRol: false });
  });

  it('ORGANIZADOR con el id de otro → 403', () => {
    expect(() => resolverOrganizador(organizador, ORG_B)).toThrow(ForbiddenException);
  });

  it('ADMIN sin organizadorId → él mismo', () => {
    expect(resolverOrganizador(admin)).toEqual({ organizadorId: ADMIN, verificarRol: false });
  });

  it('ADMIN a nombre de otro → ese id, y hay que verificar que sea ORGANIZADOR', () => {
    expect(resolverOrganizador(admin, ORG_B)).toEqual({ organizadorId: ORG_B, verificarRol: true });
  });
});
