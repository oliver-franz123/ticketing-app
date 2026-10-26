// Fila n (desde 1) → A..Z, AA..AZ, BA… Base 26 biyectiva: no hay "cero", por
// eso se resta 1 en cada paso (como las columnas de una planilla).
export function etiquetaFila(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Fila inválida: ${n}`);
  let etiqueta = '';
  for (let resto = n; resto > 0; resto = Math.floor((resto - 1) / 26)) {
    etiqueta = String.fromCharCode(65 + ((resto - 1) % 26)) + etiqueta;
  }
  return etiqueta;
}

export const etiquetasFilas = (filas: number) => Array.from({ length: filas }, (_, i) => etiquetaFila(i + 1));
