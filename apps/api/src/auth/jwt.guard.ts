import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Rol } from '@entradas/db';
import { CLAVE_PUBLICO } from './decoradores';
import type { PayloadJwt, RequestConUsuario } from './tipos';

const ROLES_VALIDOS = new Set<string>(Object.values(Rol));

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<RequestConUsuario>();
    const [esquema, token] = req.headers.authorization?.split(' ') ?? [];
    if (esquema !== 'Bearer' || !token) throw this.noAutenticado();

    let payload: PayloadJwt;
    try {
      // algorithms explícito: rechaza alg none y la confusión HS/RS.
      payload = await this.jwt.verifyAsync<PayloadJwt>(token, { algorithms: ['HS256'] });
    } catch {
      throw this.noAutenticado();
    }
    if (typeof payload.sub !== 'string' || !ROLES_VALIDOS.has(payload.rol)) throw this.noAutenticado();

    req.usuario = { id: payload.sub, rol: payload.rol };
    return true;
  }

  // Mismo mensaje para todos los fallos: no se dice si venció, si la firma no
  // coincide o si el token está mal formado.
  private noAutenticado() {
    return new UnauthorizedException('No autenticado');
  }
}
