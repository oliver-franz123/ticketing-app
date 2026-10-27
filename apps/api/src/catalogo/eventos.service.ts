import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Rol } from '@entradas/db';
import type { UsuarioAutenticado } from '../auth/tipos';
import { InventarioService } from '../inventario/inventario.service';
import { PrismaService } from '../prisma/prisma.service';
import { aNumero } from './a-numero';
import type { CrearEventoDto } from './dto/crear-evento.dto';
import type { ListarEventosQuery } from './dto/listar-eventos.query';
import { EstadoEvento, ESTADOS_PUBLICOS } from './estados-evento';
import { resolverOrganizador } from './resolver-organizador';

@Injectable()
export class EventosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
  ) {}

  // Evento + zona + grilla en UNA transacción: si la grilla falla, no queda
  // un evento sin asientos (ni asientos sin evento).
  async crear(usuario: UsuarioAutenticado, datos: CrearEventoDto) {
    // Antes de abrir la transacción: el 403 no necesita la BD.
    const { organizadorId, verificarRol } = resolverOrganizador(usuario, datos.organizadorId);
    const { zona: z } = datos;

    return this.prisma.$transaction(async (tx) => {
      // id es la PK (único total): findUnique es correcto aquí (ADR-0016).
      if (!(await tx.recinto.findUnique({ where: { id: datos.recintoId }, select: { id: true } }))) {
        throw new BadRequestException('El recinto no existe');
      }
      if (verificarRol) {
        const dueno = await tx.usuario.findUnique({ where: { id: organizadorId }, select: { rol: true } });
        if (dueno?.rol !== Rol.ORGANIZADOR) {
          throw new BadRequestException('El organizador no existe o no tiene el rol ORGANIZADOR');
        }
      }

      const evento = await tx.evento.create({
        data: {
          organizadorId,
          recintoId: datos.recintoId,
          titulo: datos.titulo,
          inicio: new Date(datos.inicio),
          ventaInicio: new Date(datos.ventaInicio),
          estado: EstadoEvento.BORRADOR,
        },
      });
      const zona = await tx.zona.create({
        data: { eventoId: evento.id, nombre: z.nombre, precioCentavos: BigInt(z.precioCentavos) },
      });
      const totalAsientos = await this.inventario.generarGrilla(tx, {
        eventoId: evento.id,
        zonaId: zona.id,
        filas: z.filas,
        columnas: z.columnas,
      });

      return {
        id: evento.id,
        titulo: evento.titulo,
        estado: evento.estado,
        inicio: evento.inicio,
        ventaInicio: evento.ventaInicio,
        organizadorId: evento.organizadorId,
        recintoId: evento.recintoId,
        zona: { id: zona.id, nombre: zona.nombre, precioCentavos: aNumero(zona.precioCentavos), moneda: zona.moneda },
        totalAsientos,
      };
    });
  }

  // RF-23. CAS sin leer antes: dos PATCH a la vez no pueden publicar los dos.
  // El dueño va en el WHERE, así que un ORGANIZADOR ajeno ve el mismo 404 que
  // un id inexistente (no se revela que el borrador existe).
  async publicar(usuario: UsuarioAutenticado, id: string) {
    const { count } = await this.prisma.evento.updateMany({
      where: {
        id,
        estado: EstadoEvento.BORRADOR,
        ...(usuario.rol !== Rol.ADMIN && { organizadorId: usuario.id }),
      },
      data: { estado: EstadoEvento.PUBLICADO },
    });
    if (count === 1) return { id, estado: EstadoEvento.PUBLICADO };

    // id es la PK (único total): findUnique es correcto aquí (ADR-0016).
    const evento = await this.prisma.evento.findUnique({ where: { id }, select: { organizadorId: true } });
    if (!evento || (usuario.rol !== Rol.ADMIN && evento.organizadorId !== usuario.id)) {
      throw new NotFoundException('Evento no encontrado');
    }
    throw new ConflictException('El evento ya no está en BORRADOR');
  }

  // RF-10: por ciudad (slug) y estado, por fecha. Usa los índices eventos(estado, inicio)
  // y recintos(ciudad_id). Desempate por id para que la paginación sea estable.
  async listar({ ciudad, estado, pagina, porPagina }: ListarEventosQuery) {
    const where = { estado, recinto: { ciudad: { slug: ciudad } } };
    const [eventos, total] = await this.prisma.$transaction([
      this.prisma.evento.findMany({
        where,
        orderBy: [{ inicio: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
        select: {
          id: true,
          titulo: true,
          inicio: true,
          ventaInicio: true,
          estado: true,
          recinto: { select: { id: true, nombre: true, ciudad: { select: { slug: true, nombre: true } } } },
        },
      }),
      this.prisma.evento.count({ where }),
    ]);

    const items = eventos.map(({ recinto: { ciudad: c, ...recinto }, ...evento }) => ({ ...evento, recinto, ciudad: c }));
    return { items, pagina, porPagina, total };
  }

  // Mapa público. Un BORRADOR da el mismo 404 que un id inexistente: no se
  // revela que el borrador existe. REPEATABLE READ: la versión y los asientos
  // salen de la misma foto de la BD (el resync por versión depende de eso).
  mapa(eventoId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        // id es la PK (único total): findUnique es correcto aquí (ADR-0016).
        const evento = await tx.evento.findUnique({
          where: { id: eventoId },
          select: {
            estado: true,
            mapaVersion: true,
            zonas: { select: { id: true, nombre: true, precioCentavos: true, moneda: true }, orderBy: { nombre: 'asc' } },
          },
        });
        if (!evento || !(ESTADOS_PUBLICOS as readonly string[]).includes(evento.estado)) {
          throw new NotFoundException('Evento no encontrado');
        }

        return {
          eventoId,
          version: aNumero(evento.mapaVersion),
          zonas: evento.zonas.map((z) => ({ ...z, precioCentavos: aNumero(z.precioCentavos) })),
          asientos: await this.inventario.snapshotMapa(eventoId, tx),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
