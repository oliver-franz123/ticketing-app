import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Rol } from '@entradas/db';
import { Publico, Roles, UsuarioActual } from '../auth/decoradores';
import type { UsuarioAutenticado } from '../auth/tipos';
import { CrearEventoDto } from './dto/crear-evento.dto';
import { ListarEventosQuery } from './dto/listar-eventos.query';
import { EventosService } from './eventos.service';

@Controller('eventos')
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  // Un ORGANIZADOR solo crea a su nombre; el ADMIN puede indicar otro organizador.
  @Roles(Rol.ORGANIZADOR, Rol.ADMIN)
  @Post()
  crear(@UsuarioActual() usuario: UsuarioAutenticado, @Body() datos: CrearEventoDto) {
    return this.eventos.crear(usuario, datos);
  }

  // Catálogo público (doc 05): caché HTTP de 30 s.
  @Publico()
  @Get()
  @Header('Cache-Control', 'public, max-age=30')
  listar(@Query() query: ListarEventosQuery) {
    return this.eventos.listar(query);
  }

  // BORRADOR → PUBLICADO, sin vuelta atrás: congela el mapa. Un ORGANIZADOR
  // solo publica lo suyo; el ADMIN, cualquiera.
  @Roles(Rol.ORGANIZADOR, Rol.ADMIN)
  @Patch(':id/publicar')
  publicar(@UsuarioActual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.eventos.publicar(usuario, id);
  }

  // Snapshot del mapa (doc 05). Sin tiempo real todavía: llega con el WebSocket.
  @Publico()
  @Get(':id/asientos')
  mapa(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventos.mapa(id);
  }
}
