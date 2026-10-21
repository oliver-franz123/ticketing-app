import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Rol } from '@entradas/db';
import { AuthService } from './auth.service';
import type { HashService } from './hash.service';

const SECRETO = 'secreto-de-prueba-de-al-menos-32-bytes!!';
const ID = '6f1c1a52-6a3b-4b8e-9a51-0c2d6c2b9e11';

describe('AuthService', () => {
  const jwt = new JwtService({ secret: SECRETO, signOptions: { algorithm: 'HS256', expiresIn: '60m' } });
  let prisma: { usuario: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> } };
  let hash: { [K in 'hashear' | 'verificar' | 'verificarSenuelo']: ReturnType<typeof vi.fn> };
  let servicio: AuthService;

  beforeEach(() => {
    prisma = { usuario: { create: vi.fn(), findUnique: vi.fn() } };
    hash = {
      hashear: vi.fn().mockResolvedValue('$argon2id$hash'),
      verificar: vi.fn(),
      verificarSenuelo: vi.fn().mockResolvedValue(false),
    };
    servicio = new AuthService(prisma as never, hash as unknown as HashService, jwt);
  });

  describe('registrar', () => {
    const datos = { email: '  Ana@Test.BO ', password: '12345678', nombre: 'Ana' };

    it('siempre crea COMPRADOR, con el hash y el email normalizado', async () => {
      prisma.usuario.create.mockResolvedValue({ id: ID, rol: Rol.COMPRADOR });
      await servicio.registrar(datos);
      expect(prisma.usuario.create).toHaveBeenCalledWith({
        data: { email: 'ana@test.bo', passwordHash: '$argon2id$hash', nombre: 'Ana', telefono: null, rol: Rol.COMPRADOR },
        select: { id: true, rol: true },
      });
    });

    it('devuelve un token con solo sub, rol, iat y exp (60 min)', async () => {
      prisma.usuario.create.mockResolvedValue({ id: ID, rol: Rol.COMPRADOR });
      const { token } = await servicio.registrar(datos);
      const payload = jwt.verify(token);
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'rol', 'sub']);
      expect(payload).toMatchObject({ sub: ID, rol: 'COMPRADOR' });
      expect(payload.exp - payload.iat).toBe(3600);
    });

    it('email repetido (P2002) → 409 genérico, sin revelar el campo', async () => {
      prisma.usuario.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.1',
          meta: { target: ['email'] },
        }),
      );
      const error = await servicio.registrar(datos).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        message: 'No se pudo completar el registro',
        error: 'Conflict',
      });
    });

    it('otros errores de la BD se propagan (no se disfrazan de 409)', async () => {
      prisma.usuario.create.mockRejectedValue(new Error('conexión caída'));
      await expect(servicio.registrar(datos)).rejects.toThrow('conexión caída');
    });
  });

  describe('login', () => {
    const credenciales = { email: 'ANA@test.bo', password: '12345678' };

    it('credenciales correctas → token', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: ID, rol: Rol.ORGANIZADOR, passwordHash: 'h' });
      hash.verificar.mockResolvedValue(true);
      const { token } = await servicio.login(credenciales);
      expect(jwt.verify(token)).toMatchObject({ sub: ID, rol: 'ORGANIZADOR' });
      expect(prisma.usuario.findUnique).toHaveBeenCalledWith({
        where: { email: 'ana@test.bo' },
        select: { id: true, rol: true, passwordHash: true },
      });
    });

    it('email inexistente → verifica contra el señuelo (mismo tiempo) y 401', async () => {
      prisma.usuario.findUnique.mockResolvedValue(null);
      await expect(servicio.login(credenciales)).rejects.toThrow(new UnauthorizedException('Email o contraseña incorrectos'));
      expect(hash.verificarSenuelo).toHaveBeenCalledWith('12345678');
    });

    it('contraseña incorrecta → el mismo 401 que el email inexistente', async () => {
      prisma.usuario.findUnique.mockResolvedValue({ id: ID, rol: Rol.COMPRADOR, passwordHash: 'h' });
      hash.verificar.mockResolvedValue(false);
      await expect(servicio.login(credenciales)).rejects.toThrow(new UnauthorizedException('Email o contraseña incorrectos'));
    });
  });
});
