// Mismos valores que el CHECK eventos_estado_chk de la migración.
// BORRADOR → PUBLICADO (congela el mapa) → FINALIZADO; BORRADOR/PUBLICADO → CANCELADO.
export const EstadoEvento = {
  BORRADOR: 'BORRADOR',
  PUBLICADO: 'PUBLICADO',
  CANCELADO: 'CANCELADO',
  FINALIZADO: 'FINALIZADO',
} as const;

export type EstadoEvento = (typeof EstadoEvento)[keyof typeof EstadoEvento];

// Lo que el público puede listar y ver. BORRADOR nunca sale del panel del organizador.
export const ESTADOS_PUBLICOS = [EstadoEvento.PUBLICADO, EstadoEvento.FINALIZADO, EstadoEvento.CANCELADO] as const;
