import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Rol } from '@entradas/db';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegistroDto } from './dto/registro.dto';
import { HashService } from './hash.service';
import type { PayloadJwt } from './tipos';

const normalizarEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hash: HashService,
    private readonly jwt: JwtService,
  ) {}

  async registrar(datos: RegistroDto) {
    const passwordHash = await this.hash.hashear(datos.password);
    try {
      const usuario = await this.prisma.usuario.create({
        data: {
          email: normalizarEmail(datos.email),
          passwordHash,
          nombre: datos.nombre,
          telefono: datos.telefono ?? null,
          rol: Rol.COMPRADOR,
        },
        select: { id: true, rol: true },
      });
      return this.firmar(usuario);
    } catch (error) {
      // Se deja que el UNIQUE decida (sin SELECT previo, que tendría carrera).
      // El 409 no dice qué campo chocó. Igual revela que el email existe: sin
      // verificación por email no se puede evitar; lo mitiga el rate limit (A-07).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('No se pudo completar el registro');
      }
      throw error;
    }
  }

  async login(datos: LoginDto) {
    // email es @unique total (no parcial): findUnique es correcto aquí (ADR-0016).
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizarEmail(datos.email) },
      select: { id: true, rol: true, passwordHash: true },
    });
    const valida = usuario
      ? await this.hash.verificar(usuario.passwordHash, datos.password)
      : await this.hash.verificarSenuelo(datos.password);

    // Mismo mensaje para email inexistente y contraseña incorrecta.
    if (!usuario || !valida) throw new UnauthorizedException('Email o contraseña incorrectos');
    return this.firmar(usuario);
  }

  private async firmar(usuario: { id: string; rol: Rol }) {
    const payload: PayloadJwt = { sub: usuario.id, rol: usuario.rol };
    return { token: await this.jwt.signAsync(payload) };
  }
}
