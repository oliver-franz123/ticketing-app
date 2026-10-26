import { describe, expect, it } from 'vitest';
import { BANDERA_REMOTA, verificarDestino } from '../prisma/semillas/proteccion.mts';

const LOCAL = 'postgresql://entradas:entradas@localhost:5432/entradas';
const POOLER = 'postgresql://postgres.abc:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';
const DIRECTA = 'postgresql://postgres:x@db.abc.supabase.co:5432/postgres';

describe('verificarDestino', () => {
  it('permite la base local en desarrollo', () => {
    expect(verificarDestino({ NODE_ENV: 'development', DATABASE_URL: LOCAL }, [])).toEqual({ permitido: true });
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production', DATABASE_URL: LOCAL }],
    ['el pooler de Supabase', { NODE_ENV: 'development', DATABASE_URL: POOLER }],
    ['la conexión directa de Supabase', { NODE_ENV: 'development', DATABASE_URL: DIRECTA }],
  ])('se niega con %s y permite con la bandera', (_, env) => {
    expect(verificarDestino(env, [])).toMatchObject({ permitido: false });
    const conBandera = verificarDestino(env, [BANDERA_REMOTA]);
    expect(conBandera.permitido).toBe(true);
    expect(conBandera).toHaveProperty('advertencia');
  });

  it('se niega sin DATABASE_URL o con una URL inválida, aunque tenga la bandera', () => {
    expect(verificarDestino({}, [BANDERA_REMOTA])).toMatchObject({ permitido: false });
    expect(verificarDestino({ DATABASE_URL: 'no es una url' }, [BANDERA_REMOTA])).toMatchObject({ permitido: false });
  });

  it('no se deja engañar por "supabase" en el usuario o la base', () => {
    const url = 'postgresql://supabase.co:x@localhost:5432/supabase.co';
    expect(verificarDestino({ DATABASE_URL: url }, [])).toEqual({ permitido: true });
  });
});
