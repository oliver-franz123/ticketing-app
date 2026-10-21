import { Controller, Get } from '@nestjs/common';
import { Publico } from '../auth/decoradores';

// Usado por el smoke test del deploy y por el health check de Fly (doc 07 §7).
@Controller('health')
export class SaludController {
  @Publico()
  @Get()
  verificar() {
    return { estado: 'ok' };
  }
}
