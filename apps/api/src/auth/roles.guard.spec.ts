import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Rol } from '@entradas/db';
import { RolesGuard } from './roles.guard';

const contexto = (rol: Rol | undefined, roles: Rol[] | undefined): ExecutionContext => {
  const handler = () => undefined;
  if (roles) Reflect.defineMetadata('roles', roles, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ usuario: rol ? { id: 'x', rol } : undefined }) }),
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('sin @Roles deja pasar a cualquier autenticado', () => {
    expect(guard.canActivate(contexto(Rol.COMPRADOR, undefined))).toBe(true);
  });

  it('deja pasar si el rol está en la lista', () => {
    expect(guard.canActivate(contexto(Rol.ORGANIZADOR, [Rol.ORGANIZADOR, Rol.ADMIN]))).toBe(true);
  });

  it('rechaza con 403 si el rol no está en la lista', () => {
    expect(() => guard.canActivate(contexto(Rol.COMPRADOR, [Rol.ORGANIZADOR, Rol.ADMIN]))).toThrow(ForbiddenException);
  });

  it('ADMIN no pasa implícitamente si no está en la lista', () => {
    expect(() => guard.canActivate(contexto(Rol.ADMIN, [Rol.VALIDADOR]))).toThrow(ForbiddenException);
  });
});
