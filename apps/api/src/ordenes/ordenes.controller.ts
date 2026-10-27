import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Rol } from '@entradas/db';
import { Roles, UsuarioActual } from '../auth/decoradores';
import type { UsuarioAutenticado } from '../auth/tipos';
import { ClaveIdempotencia } from './clave-idempotencia';
import { CrearOrdenDto } from './dto/crear-orden.dto';
import { OrdenesService } from './ordenes.service';

@Controller('ordenes')
export class OrdenesController {
  constructor(private readonly ordenes: OrdenesService) {}

  // Reservar = crear la orden PENDIENTE_PAGO con sus asientos (doc 04 §4.1).
  // Solo COMPRADOR: el ADMIN tampoco compra con su cuenta de administración.
  @Roles(Rol.COMPRADOR)
  @Post()
  @HttpCode(201)
  crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @ClaveIdempotencia() clave: string,
    @Body() datos: CrearOrdenDto,
  ) {
    return this.ordenes.crear(usuario, clave, datos);
  }
}
