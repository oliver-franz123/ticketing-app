import { createHmac } from 'node:crypto';
import { ahora } from './jwt-prueba';

// Firma webhooks del simulador a mano, como jwt-prueba.ts con los JWT: el test
// no depende del código que prueba y puede fabricar firmas malas (P-02).
export const SECRETO_SIMULADOR = 'secreto-del-simulador-de-prueba-de-32-bytes!!';

// "t=<unix>,v1=<hex>", v1 = HMAC-SHA256(secreto, "<t>.<rawBody>") (ADR-0015).
export function firmaSimulador(cuerpo: string, { secreto = SECRETO_SIMULADOR, t = ahora() } = {}) {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
