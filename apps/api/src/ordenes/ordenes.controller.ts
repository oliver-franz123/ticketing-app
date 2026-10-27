import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Rol } from '@entradas/db';
import { Roles, UsuarioActual } from '../auth/decoradores';
import type { UsuarioAutenticado } from '../auth/tipos';
import { ClaveIdempotencia } from './clave-idempotencia';
import { CrearOrdenDto } from './dto/crear-orden.dto';
import { OrdenesService } from './ordenes.service';
import { PagosService } from './pagos/pagos.service';

@Controller('ordenes')
export class OrdenesController {
  constructor(
    private readonly ordenes: OrdenesService,
    private readonly pagos: PagosService,
  ) {}

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

  // Inicia el pago (doc 05 §4): crea el intento en el proveedor y devuelve
  // adónde mandar al comprador. Solo el dueño: una orden ajena da el mismo 404
  // que una inexistente. 200 y no 201: un doble clic devuelve el mismo intento,
  // no crea otro. ParseUUIDPipe: un id que no es UUID da 400 antes de tocar la BD.
  @Roles(Rol.COMPRADOR)
  @Post(':id/pago')
  @HttpCode(200)
  pagar(@UsuarioActual() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.pagos.iniciarPago(usuario, id);
  }
}
