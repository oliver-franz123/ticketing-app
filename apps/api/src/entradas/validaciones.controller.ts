import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Rol } from '@entradas/db';
import { Roles, UsuarioActual } from '../auth/decoradores';
import type { UsuarioAutenticado } from '../auth/tipos';
import { ValidarDto } from './dto/validar.dto';
import { ValidacionesService } from './validaciones.service';

@Controller('validaciones')
export class ValidacionesController {
  constructor(private readonly validaciones: ValidacionesService) {}

  // 200 siempre que el pedido esté bien formado: VALIDA, YA_USADA, INVALIDA y
  // OTRO_EVENTO son respuestas del negocio, no errores HTTP (doc 05). El ADMIN
  // también valida (soporte en la puerta).
  @Roles(Rol.VALIDADOR, Rol.ADMIN)
  @Post()
  @HttpCode(200)
  validar(@UsuarioActual() usuario: UsuarioAutenticado, @Body() datos: ValidarDto) {
    return this.validaciones.validar(usuario, datos);
  }
}
