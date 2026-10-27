import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { isUUID } from 'class-validator';

// Header Idempotency-Key obligatorio y UUID (es una columna uuid). Sin él, un
// reintento de red tras perder la respuesta recibiría 409 por su propio
// asiento (doc 04 §7, fila 2). @Headers() de Nest no acepta pipes: por eso
// es un decorador propio.
export const ClaveIdempotencia = createParamDecorator((_dato: unknown, ctx: ExecutionContext) => {
  const valor = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers['idempotency-key'];
  if (typeof valor !== 'string' || !isUUID(valor)) {
    throw new BadRequestException('Falta el header Idempotency-Key o no es un UUID');
  }
  return valor.toLowerCase();
});
