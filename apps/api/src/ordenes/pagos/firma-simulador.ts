import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOLERANCIA_FIRMA_SEGUNDOS } from '@entradas/shared';

// Verifica la cabecera Simulador-Firma (ADR-0015): "t=<unix>,v1=<hex>", con
// v1 = HMAC-SHA256(secreto, "<t>.<rawBody>"). Función pura: el adaptador decide
// qué responder. `ahora` en segundos se inyecta para probar la tolerancia sin
// relojes falsos.
//
// Por qué cada paso:
// - rawBody: los bytes EXACTOS recibidos. Si se re-serializa el JSON (otro
//   orden de claves, otros espacios), el HMAC cambia y la firma no coincide.
// - t dentro del HMAC: un atacante no puede tomar una firma vieja y cambiarle
//   el t para pasar la tolerancia.
// - tolerancia ±5 min: un webhook capturado no se puede repetir más tarde (replay).
//   La idempotencia cubre la repetición dentro de esa ventana.
// - timingSafeEqual: comparar con === corta en el primer byte distinto, y el
//   tiempo de respuesta revelaría cuántos bytes acertó un atacante.
export function firmaSimuladorValida(
  cabecera: string | undefined,
  rawBody: Uint8Array,
  secreto: string,
  ahora: number = Math.floor(Date.now() / 1000),
): boolean {
  const partes = leerCabecera(cabecera);
  if (!partes) return false;
  if (Math.abs(ahora - partes.t) > TOLERANCIA_FIRMA_SEGUNDOS) return false;

  const esperado = createHmac('sha256', secreto)
    .update(`${partes.t}.`)
    .update(rawBody)
    .digest();
  const recibido = Buffer.from(partes.v1, 'hex');
  // timingSafeEqual lanza si los largos difieren; el largo no es secreto.
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}

// "t=1730000000,v1=<64 hex>". Cualquier otra forma es inválida: sin
// heurísticas para "arreglar" una cabecera rara.
function leerCabecera(cabecera: string | undefined): { t: number; v1: string } | null {
  if (!cabecera) return null;
  const campos = new Map(
    cabecera.split(',').map((par) => {
      const i = par.indexOf('=');
      return [par.slice(0, i).trim(), par.slice(i + 1).trim()] as const;
    }),
  );
  const t = campos.get('t');
  const v1 = campos.get('v1');
  if (!t || !/^\d{1,12}$/.test(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return { t: Number(t), v1 };
}
