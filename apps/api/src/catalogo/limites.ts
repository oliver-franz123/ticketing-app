// Límite de la grilla por request (una zona). El riesgo no es el tamaño del body
// (dos números, y Express ya corta el JSON en 100 KB) sino la amplificación:
// {"filas": 100000, "columnas": 100000} pesa 40 bytes y pediría 10^10 filas.
// 15.000 es el peor caso de evento de doc 06 §1; los topes por dimensión
// mantienen las etiquetas legibles (fila 100 = CV).
export const MAX_FILAS = 100;
export const MAX_COLUMNAS = 200;
export const MAX_ASIENTOS_POR_ZONA = 15_000;

// Bs 100.000 en centavos (ADR-0010). Muy por debajo de Number.MAX_SAFE_INTEGER,
// así el monto viaja como número en el JSON sin perder precisión.
export const MAX_PRECIO_CENTAVOS = 10_000_000;
