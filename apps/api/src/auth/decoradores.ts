import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Rol } from '@entradas/db';
import type { RequestConUsuario } from './tipos';

export const CLAVE_PUBLICO = 'publico';
export const CLAVE_ROLES = 'roles';

// Los guards son globales: todo endpoint exige JWT salvo que se marque @Publico().
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

// Regla del equipo (CLAUDE.md): todo endpoint no público declara @Roles(...).
// Omitirlo solo vale si sirve a cualquier autenticado, con un comentario.
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

export const UsuarioActual = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<RequestConUsuario>().usuario,
);
