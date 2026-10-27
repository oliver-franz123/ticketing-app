import { Controller, HttpCode, Param, Post, type RawBodyRequest, Req } from '@nestjs/common';
import type { CabecerasHttp } from '@entradas/shared';
import { Publico } from '../../auth/decoradores';
import { PagosService } from './pagos.service';

// Lo único que se usa de la request. Con rawBody: true en la creación de la
// app, Nest guarda los bytes originales del JSON en req.rawBody (Buffer).
type RequestWebhook = RawBodyRequest<{ headers: CabecerasHttp }>;

@Controller('webhooks/pagos')
export class WebhooksController {
  constructor(private readonly pagos: PagosService) {}

  // Sin JWT ni @Roles: quien llama es el proveedor, no un usuario. La
  // autenticación es la firma HMAC sobre el raw body (doc 05 §4, ADR-0015).
  // Nunca @Body(): el JSON re-serializado ya no coincide con lo firmado.
  // 200 siempre que la firma sea válida, también a duplicados: con un 4xx/5xx
  // el proveedor seguiría reintentando. 400 si la firma no es válida.
  @Publico()
  @Post(':proveedor')
  @HttpCode(200)
  async recibir(@Param('proveedor') proveedor: string, @Req() req: RequestWebhook) {
    await this.pagos.procesarWebhook(proveedor, req.headers, req.rawBody);
    // El resultado (DUPLICADO, PAGADA…) queda en los logs, no en la respuesta:
    // el proveedor no necesita conocer el estado interno de la orden.
    return { recibido: true };
  }
}
