import { Controller, Get, Header, Query } from '@nestjs/common';
import { Publico } from '../auth/decoradores';
import { PrismaService } from '../prisma/prisma.service';
import { ListarRecintosQuery } from './dto/listar-recintos.query';

// Lectura mínima para el script de la carrera y el futuro panel del
// organizador. Sin alta de recintos por la API: salen de la semilla.
@Controller('recintos')
export class RecintosController {
  constructor(private readonly prisma: PrismaService) {}

  // Público como el catálogo: nombre y dirección no son datos personales.
  @Publico()
  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  async listar(@Query() { ciudad }: ListarRecintosQuery) {
    const recintos = await this.prisma.recinto.findMany({
      where: { ciudad: { slug: ciudad } },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      select: { id: true, nombre: true, direccion: true, ciudad: { select: { slug: true, nombre: true } } },
    });
    return { items: recintos };
  }
}
