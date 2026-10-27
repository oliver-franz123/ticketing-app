import { createHmac } from 'node:crypto';
import { firmaSimuladorValida } from './firma-simulador';

// La firma esperada se calcula aquí, a mano, y no con el código que se prueba.
const SECRETO = 'secreto-de-prueba-del-simulador-32-bytes!!';
const AHORA = 1_730_000_000;
const CUERPO = Buffer.from('{"id":"sim_evt_1","tipo":"pago.exitoso","montoCentavos":30100}');

const firmar = (cuerpo: Buffer, { secreto = SECRETO, t = AHORA } = {}) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo.toString('utf8')}`).digest('hex')}`;

const valida = (cabecera: string | undefined, cuerpo = CUERPO) =>
  firmaSimuladorValida(cabecera, cuerpo, SECRETO, AHORA);

describe('firmaSimuladorValida', () => {
  it('acepta una firma correcta', () => {
    expect(valida(firmar(CUERPO))).toBe(true);
  });

  it('acepta los campos en otro orden y con espacios', () => {
    const [t, v1] = firmar(CUERPO).split(',');
    expect(valida(`${v1}, ${t}`)).toBe(true);
  });

  it('rechaza el cuerpo alterado en un solo byte (30100 → 30000)', () => {
    const alterado = Buffer.from(CUERPO.toString('utf8').replace('30100', '30000'));
    expect(valida(firmar(CUERPO), alterado)).toBe(false);
  });

  it('rechaza el mismo JSON re-serializado con otros espacios', () => {
    const reserializado = Buffer.from(JSON.stringify(JSON.parse(CUERPO.toString('utf8')), null, 1));
    expect(valida(firmar(CUERPO), reserializado)).toBe(false);
  });

  it('rechaza una firma hecha con otro secreto', () => {
    expect(valida(firmar(CUERPO, { secreto: 'otro-secreto-de-prueba-de-32-bytes-!!!!' }))).toBe(false);
  });

  it('rechaza un t cambiado a mano aunque v1 sea de una firma válida', () => {
    const v1 = firmar(CUERPO, { t: AHORA - 3600 }).split(',')[1];
    expect(valida(`t=${AHORA},${v1}`)).toBe(false);
  });

  it('tolera exactamente 300 s hacia atrás y hacia adelante', () => {
    expect(valida(firmar(CUERPO, { t: AHORA - 300 }))).toBe(true);
    expect(valida(firmar(CUERPO, { t: AHORA + 300 }))).toBe(true);
  });

  it('rechaza 301 s hacia atrás (replay) y 301 s hacia adelante', () => {
    expect(valida(firmar(CUERPO, { t: AHORA - 301 }))).toBe(false);
    expect(valida(firmar(CUERPO, { t: AHORA + 301 }))).toBe(false);
  });

  it.each([
    ['ausente', undefined],
    ['vacía', ''],
    ['sin v1', `t=${AHORA}`],
    ['sin t', `v1=${'a'.repeat(64)}`],
    ['t no numérico', `t=ayer,v1=${'a'.repeat(64)}`],
    ['v1 corto', `t=${AHORA},v1=abcd`],
    ['v1 no hex', `t=${AHORA},v1=${'z'.repeat(64)}`],
    ['v1 en mayúsculas', firmar(CUERPO).toUpperCase().replace('T=', 't=').replace('V1=', 'v1=')],
  ])('rechaza una cabecera mal formada: %s', (_caso, cabecera) => {
    expect(valida(cabecera)).toBe(false);
  });
});
