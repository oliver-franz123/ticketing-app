import type { KeyObject } from 'node:crypto';

export type PayloadQr = { t: string; e: string; i: number };
type EntradaQr = { id: string; eventoId: string; emitidaEn: Date };

// Stub: el rojo de qr.spec.ts es de comportamiento, no de compilación.
export const firmarQr: (entrada: EntradaQr, clave: KeyObject) => string = () => {
  throw new Error('no implementado');
};

export const verificarQr: (qr: string, clavePublica: KeyObject) => PayloadQr | null = () => {
  throw new Error('no implementado');
};
