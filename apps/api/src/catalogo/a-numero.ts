// Los montos y versiones son bigint en la BD, pero el contrato REST los manda
// como número (doc 05: {"precioCentavos": 30000}). JSON.stringify no sabe
// serializar bigint, así que se convierten aquí, en la frontera.
export function aNumero(valor: bigint): number {
  if (valor > BigInt(Number.MAX_SAFE_INTEGER) || valor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${valor} no cabe en un número de JSON sin perder precisión`);
  }
  return Number(valor);
}
