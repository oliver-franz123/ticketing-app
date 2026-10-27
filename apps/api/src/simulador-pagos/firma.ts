import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';

// El lado del "proveedor" firma (ADR-0015); la API verifica con su propio
// código (ordenes/pagos/firma-simulador.ts). Son dos implementaciones a
// propósito: el simulador no importa nada de Pagos, como un tercero real.
//
// Cabecera: "t=<unix>,v1=<hex>", v1 = HMAC-SHA256(secreto, "<t>.<cuerpo>").
// t se toma en cada envío: un reintento lleva una firma nueva y pasa la
// tolerancia de 5 min aunque el primer intento haya sido hace 10.
export function firmar(secreto: string, cuerpo: string, t: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

// Mismo requisito que la API (32 bytes), comprobado aquí por su cuenta.
export function leerSecretoFirma(config: ConfigService): string {
  const secreto = config.get<string>('SIMULADOR_WEBHOOK_SECRET');
  if (!secreto || Buffer.byteLength(secreto, 'utf8') < 32) {
    throw new Error('SIMULADOR_WEBHOOK_SECRET debe tener al menos 32 bytes. Generarlo con: openssl rand -base64 32');
  }
  return secreto;
}
