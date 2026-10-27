import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Publico } from '../auth/decoradores';
import { CrearPagoSimuladorDto } from './dto/crear-pago-simulador.dto';
import { SimuladorPagosService } from './simulador-pagos.service';

@Controller('simulador')
export class SimuladorPagosController {
  constructor(private readonly simulador: SimuladorPagosService) {}

  // "API del proveedor": la llama SimuladorAdapter.crearIntento por HTTP.
  // Público y sin @Roles: no lo llama un usuario. Un proveedor real pediría una
  // API key; aquí no hace falta, porque un intento creado por cualquiera no
  // tiene efecto: el webhook solo actúa sobre referencias que están en pagos.
  // El módulo ni siquiera existe sin SIMULADOR_HABILITADO=true.
  @Publico()
  @Post('pagos')
  @HttpCode(201)
  crear(@Body() datos: CrearPagoSimuladorDto) {
    return this.simulador.crear(datos);
  }
}
