import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntradasService } from './entradas.service';
import { CLAVE_QR_PUBLICA, leerClavePublicaQr } from './qr/clave-qr';
import { ValidacionesController } from './validaciones.controller';
import { ValidacionesService } from './validaciones.service';

// Dueño de entradas y validaciones (doc 03 §4). Emite dentro de la transacción
// del pago y valida en la puerta; mis-entradas y el PDF por la API quedan fuera
// de la demo (los manda el Worker por email).
@Module({
  controllers: [ValidacionesController],
  providers: [
    EntradasService,
    ValidacionesService,
    // Sin clave pública válida la API no arranca (leerClavePublicaQr).
    { provide: CLAVE_QR_PUBLICA, inject: [ConfigService], useFactory: leerClavePublicaQr },
  ],
  exports: [EntradasService],
})
export class EntradasModule {}
