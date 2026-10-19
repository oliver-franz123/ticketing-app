import { Controller, Get } from '@nestjs/common';

// Usado por el smoke test del deploy y por el health check de Fly (doc 07 §7).
@Controller('health')
export class SaludController {
  @Get()
  verificar() {
    return { estado: 'ok' };
  }
}
