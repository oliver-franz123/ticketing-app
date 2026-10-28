import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Publico } from '../auth/decoradores';
import { ConfirmarPagoSimuladorDto } from './dto/confirmar-pago-simulador.dto';
import { CrearPagoSimuladorDto } from './dto/crear-pago-simulador.dto';
import { paginaDePago, paginaEnviado, paginaYaProcesado } from './pagina';
import { SimuladorPagosService } from './simulador-pagos.service';

// Formato que emite el simulador. Cualquier otra cosa da el mismo 404 que una
// referencia inexistente, sin llegar a la BD.
const REFERENCIA = /^sim_pay_[0-9a-f]{32}$/;
const HTML = 'text/html; charset=utf-8';

const noEncontrado = () => new NotFoundException('Pago no encontrado');

// Lo único que se usa de la respuesta de Express: el código de estado.
type RespuestaHttp = { status(codigo: number): unknown };

// Todas las rutas son públicas y sin @Roles: no las usa un usuario de la
// tienda. La "API del proveedor" la llama SimuladorAdapter, y la página la abre
// el comprador desde el redirectUrl; lo que la protege es la referencia de 128
// bits. El módulo ni siquiera existe sin SIMULADOR_HABILITADO=true.
@Controller('simulador')
export class SimuladorPagosController {
  constructor(
    private readonly simulador: SimuladorPagosService,
    private readonly config: ConfigService,
  ) {}

  // Enlace "Volver a YaKache" a la orden en la web. Sin WEB_PUBLIC_URL no hay
  // enlace (la página lo oculta).
  private volver(ordenId?: string) {
    const web = this.config.get<string>('WEB_PUBLIC_URL')?.replace(/\/+$/, '');
    if (!web) return undefined;
    return ordenId ? `${web}/ordenes/${encodeURIComponent(ordenId)}` : web;
  }

  // "API del proveedor": la llama SimuladorAdapter.crearIntento por HTTP. Un
  // proveedor real pediría una API key; aquí no hace falta, porque un intento
  // creado por cualquiera no tiene efecto: el webhook solo actúa sobre
  // referencias que están en pagos.
  @Publico()
  @Post('pagos')
  @HttpCode(201)
  crear(@Body() datos: CrearPagoSimuladorDto) {
    return this.simulador.crear(datos);
  }

  // Página de pago. Si ya se confirmó, muestra "ya procesado" en vez del
  // formulario: volver atrás en el navegador no ofrece confirmar de nuevo.
  @Publico()
  @Get('pagar/:referencia')
  @Header('Content-Type', HTML)
  async pagina(@Param('referencia') referencia: string) {
    const pago = REFERENCIA.test(referencia) ? await this.simulador.buscar(referencia) : null;
    if (!pago) throw noEncontrado();
    const volver = this.volver(pago.ordenId);
    return pago.estado === 'PENDIENTE' ? paginaDePago(pago, volver) : paginaYaProcesado(volver);
  }

  // Confirma el modo elegido. 200 con la página "enviado" (el webhook sale en
  // segundo plano, nunca aquí), 409 con "ya procesado" si se envía dos veces,
  // 404 si no existe, 400 si el formulario no es válido (lo decide el
  // ValidationPipe antes de llegar aquí).
  @Publico()
  @Post('pagar/:referencia')
  @HttpCode(200)
  @Header('Content-Type', HTML)
  async confirmar(
    @Param('referencia') referencia: string,
    @Body() datos: ConfirmarPagoSimuladorDto,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ) {
    if (!REFERENCIA.test(referencia)) throw noEncontrado();
    const resultado = await this.simulador.confirmar(referencia, datos);
    if (resultado === 'NO_EXISTE') throw noEncontrado();
    // Solo para el enlace de vuelta: la confirmación ya quedó hecha arriba.
    const volver = this.volver((await this.simulador.buscar(referencia))?.ordenId);
    if (resultado === 'YA_PROCESADO') {
      respuesta.status(409);
      return paginaYaProcesado(volver);
    }
    return paginaEnviado(datos.modo, volver);
  }
}
