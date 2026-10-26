// Las semillas crean usuarios con una contraseña conocida por el equipo: en una
// base remota serían una puerta trasera. Por eso el script se niega a correr
// contra producción o Supabase salvo que se pida explícitamente.
export const BANDERA_REMOTA = '--permitir-remota';

// Pooler (aws-0-sa-east-1.pooler.supabase.com) y conexión directa (db.<ref>.supabase.co).
const HOSTS_REMOTOS = ['.pooler.supabase.com', '.supabase.co'];

export type Destino =
  | { permitido: true; advertencia?: string }
  | { permitido: false; motivo: string };

export function verificarDestino(env: NodeJS.ProcessEnv, argv: readonly string[]): Destino {
  const url = env.DATABASE_URL;
  if (!url) return { permitido: false, motivo: 'Falta DATABASE_URL.' };

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { permitido: false, motivo: 'DATABASE_URL no es una URL válida.' };
  }

  const riesgos: string[] = [];
  if (env.NODE_ENV === 'production') riesgos.push('NODE_ENV=production');
  if (HOSTS_REMOTOS.some((sufijo) => host.endsWith(sufijo))) riesgos.push(`DATABASE_URL apunta a Supabase (${host})`);

  if (riesgos.length === 0) return { permitido: true };
  if (argv.includes(BANDERA_REMOTA)) {
    return { permitido: true, advertencia: `Sembrando con ${BANDERA_REMOTA}: ${riesgos.join(' y ')}.` };
  }
  return {
    permitido: false,
    motivo: `Me niego a sembrar: ${riesgos.join(' y ')}. Si es intencional, agrega ${BANDERA_REMOTA}.`,
  };
}
