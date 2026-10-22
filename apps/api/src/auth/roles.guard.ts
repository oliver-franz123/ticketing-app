import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Rol } from '@entradas/db';
import { CLAVE_ROLES } from './decoradores';
import type { RequestConUsuario } from './tipos';

// Corre después de JwtGuard: si llega aquí, el usuario ya está autenticado.
// ADMIN no tiene pase libre: tiene que figurar en @Roles(...).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(CLAVE_ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles) return true;

    const { usuario } = ctx.switchToHttp().getRequest<RequestConUsuario>();
    if (!usuario || !roles.includes(usuario.rol)) {
      throw new ForbiddenException('No tiene permiso para esta acción');
    }
    return true;
  }
}
