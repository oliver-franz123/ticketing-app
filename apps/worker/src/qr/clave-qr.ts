import type { ConfigService } from '@nestjs/config';
import type { KeyObject } from 'node:crypto';

// Stub: el rojo de clave-qr.spec.ts es de comportamiento, no de compilación.
export const leerClavePrivadaQr: (config: ConfigService) => KeyObject = () => {
  throw new Error('no implementado');
};
