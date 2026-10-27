import { LOCALE, MONEDA, ZONA_HORARIA } from '@entradas/shared';

// Montos en centavos (ADR-0010): 15050 → "Bs 150,50".
const moneda = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: MONEDA });
export const formatearMonto = (centavos: number) => moneda.format(centavos / 100);

// Fechas en UTC desde la API, mostradas en la hora de Bolivia.
const fecha = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
export const formatearFecha = (iso: string) => fecha.format(new Date(iso));

// Ciudades de la semilla (Región Metropolitana Kanata). Sin endpoint de
// ciudades todavía: se mantienen a mano junto con packages/db/prisma/semillas/datos.mts.
export const CIUDADES = [
  { slug: 'cochabamba', nombre: 'Cochabamba' },
  { slug: 'quillacollo', nombre: 'Quillacollo' },
  { slug: 'sacaba', nombre: 'Sacaba' },
  { slug: 'tiquipaya', nombre: 'Tiquipaya' },
  { slug: 'colcapirhua', nombre: 'Colcapirhua' },
  { slug: 'vinto', nombre: 'Vinto' },
  { slug: 'sipe-sipe', nombre: 'Sipe Sipe' },
] as const;
