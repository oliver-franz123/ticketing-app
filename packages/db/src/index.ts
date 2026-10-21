// Punto de entrada único al cliente generado: api y worker importan de
// '@entradas/db' y nunca de la carpeta generated.
export * from './generated/prisma/client.js';

// Prisma 7 necesita un driver adapter. Se reexporta desde aquí para que api y
// worker usen la misma versión que @prisma/client.
export { PrismaPg } from '@prisma/adapter-pg';
