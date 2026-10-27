// Cliente HTTP mínimo contra la API (doc 05). El token vive en sessionStorage
// (se borra al cerrar la pestaña) y se manda como Bearer; sin cookies, así
// que no hay CSRF que cuidar.
const BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo?: string,
  ) {
    super(message);
  }
}

type Opciones = { metodo?: string; body?: unknown; token?: string | null; headers?: Record<string, string> };

export async function api<T>(ruta: string, { metodo = 'GET', body, token, headers = {} }: Opciones = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    // Redes móviles: la API no respondió. El que llama decide si reintenta.
    throw new ErrorApi(0, 'No se pudo conectar con el servidor. Revisa tu conexión.');
  }
  const datos = r.status === 204 ? undefined : await r.json().catch(() => undefined);
  if (!r.ok) {
    const mensaje = Array.isArray(datos?.message) ? datos.message.join('. ') : (datos?.message ?? `Error ${r.status}`);
    throw new ErrorApi(r.status, mensaje, datos?.codigo);
  }
  return datos as T;
}

// crypto.randomUUID solo existe en contextos seguros (https o localhost): al
// probar desde el celular por la IP de la red local no está. getRandomValues sí.
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
