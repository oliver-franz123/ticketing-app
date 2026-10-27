import { Module } from '@nestjs/common';
import { EntradasService } from './entradas.service';

// Dueño de entradas (doc 03 §4). Por ahora solo emite; mis-entradas, el PDF y
// la validación en puerta llegan en sus propios slices.
@Module({
  providers: [EntradasService],
  exports: [EntradasService],
})
export class EntradasModule {}
