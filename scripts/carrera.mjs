// Demo de la carrera (doc 10, C-01): N compradores distintos piden el MISMO
// asiento a la vez. Exactamente 1 gana (201) y el resto recibe 409.
//   npm run demo:carrera
//   npm run demo:carrera -- --base-url https://<app>.fly.dev --password '<SEED_PASSWORD>'
// Sin dependencias: fetch y parseArgs de Node 22. No toca la BD: todo pasa por la API.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { parseArgs } from 'node:util';

const { values: opciones } = parseArgs({
  args: argv.slice(2),
  options: {
    'base-url': { type: 'string', default: 'http://localhost:3000' },
    'recinto-id': { type: 'string' },
    ciudad: { type: 'string', default: 'cochabamba' },
    n: { type: 'string', default: '50' },
    'email-organizador': { type: 'string', default: 'organizador@entradas.test' },
    password: { type: 'string' },
  },
});

const BASE = opciones['base-url'].replace(/\/+$/, '');
const N = Number(opciones.n);
if (!Number.isInteger(N) || N < 2 || N > 500) falla('--n tiene que ser un entero entre 2 y 500');

// La contraseña del organizador semilla: flag, variable de entorno o el .env de la raíz.
const password = opciones.password ?? env.SEED_PASSWORD ?? leerDelEnv('SEED_PASSWORD');
if (!password) falla('Falta la contraseña del organizador: --password o SEED_PASSWORD (ver .env.example)');

function falla(mensaje) {
  console.error(`✗ ${mensaje}`);
  exit(1);
}

function leerDelEnv(clave) {
  try {
    const texto = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const linea = texto.split('\n').findLast((l) => l.startsWith(`${clave}=`));
    return linea?.slice(clave.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function api(metodo, ruta, { token, body, headers = {} } = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  const texto = await r.text();
  let datos;
  try {
    datos = texto ? JSON.parse(texto) : undefined;
  } catch {
    datos = texto;
  }
  return { status: r.status, datos };
}

async function esperar(metodo, ruta, estado, opcionesPedido) {
  const r = await api(metodo, ruta, opcionesPedido);
  if (r.status !== estado) falla(`${metodo} ${ruta} → ${r.status} (se esperaba ${estado}): ${JSON.stringify(r.datos)}`);
  return r.datos;
}

// Lotes: argon2id tarda ~50 ms por hash; 50 registros a la vez saturan la API.
async function enLotes(cantidad, tamano, fn) {
  const resultados = [];
  for (let i = 0; i < cantidad; i += tamano) {
    const lote = Array.from({ length: Math.min(tamano, cantidad - i) }, (_, j) => fn(i + j));
    resultados.push(...(await Promise.all(lote)));
  }
  return resultados;
}

const DIA = 24 * 3600 * 1000;
const inicio = performance.now();
console.log(`▶ Carrera contra ${BASE} con ${N} compradores\n`);

// 1. Organizador semilla y recinto.
const { token: tokenOrg } = await esperar('POST', '/auth/login', 200, {
  body: { email: opciones['email-organizador'], password },
});
let recintoId = opciones['recinto-id'];
if (!recintoId) {
  const { items } = await esperar('GET', `/recintos?ciudad=${encodeURIComponent(opciones.ciudad)}`, 200);
  if (!items.length) falla(`No hay recintos en "${opciones.ciudad}". Corre npm run seed o pasa --recinto-id`);
  recintoId = items[0].id;
}

// 2. Evento de 1 fila × 10, a la venta desde ayer, publicado.
const sufijo = randomUUID().slice(0, 8);
const evento = await esperar('POST', '/eventos', 201, {
  token: tokenOrg,
  body: {
    titulo: `Carrera ${sufijo}`,
    recintoId,
    inicio: new Date(Date.now() + 30 * DIA).toISOString(),
    ventaInicio: new Date(Date.now() - DIA).toISOString(),
    zona: { nombre: 'General', precioCentavos: 5000, filas: 1, columnas: 10 },
  },
});
await esperar('PATCH', `/eventos/${evento.id}/publicar`, 200, { token: tokenOrg });
const mapaAntes = await esperar('GET', `/eventos/${evento.id}/asientos`, 200);
const objetivo = mapaAntes.asientos.find((a) => a.fila === 'A' && a.columna === 1);
console.log(`✓ Evento ${evento.id} publicado; asiento en disputa: A1 (${objetivo.id})`);

// 3. N compradores nuevos. El registro ya devuelve el token.
const tokens = await enLotes(N, 10, async (i) => {
  const { token } = await esperar('POST', '/auth/registro', 201, {
    body: { email: `carrera-${sufijo}-${i}@demo.test`, password: `carrera-${sufijo}`, nombre: `Comprador ${i + 1}` },
  });
  return token;
});
console.log(`✓ ${N} compradores registrados`);

// 4. Calentar: abrir las conexiones keep-alive antes, para que las N peticiones
// salgan juntas en vez de escalonarse abriendo sockets TCP (igual que el e2e C-01).
await Promise.all(tokens.map(() => fetch(`${BASE}/health`).then((r) => r.text())));

// 5. La carrera: todas a la vez, cada una con su Idempotency-Key.
const t0 = performance.now();
const respuestas = await Promise.all(
  tokens.map(async (token, i) => {
    const t = performance.now();
    const r = await api('POST', '/ordenes', {
      token,
      headers: { 'Idempotency-Key': randomUUID() },
      body: { eventoId: evento.id, asientoIds: [objetivo.id] },
    });
    return {
      comprador: i + 1,
      status: r.status,
      resultado: r.status === 201 ? `orden ${r.datos.ordenId.slice(0, 8)}…` : (r.datos?.codigo ?? r.datos?.message),
      ms: Math.round(performance.now() - t),
    };
  }),
);
const msCarrera = Math.round(performance.now() - t0);

console.log('');
console.table(respuestas);

// 6. Resumen y verificación en el mapa público.
const cuenta = (s) => respuestas.filter((r) => r.status === s).length;
const ganadores = cuenta(201);
const conflictos = cuenta(409);
const otros = N - ganadores - conflictos;
const mapa = await esperar('GET', `/eventos/${evento.id}/asientos`, 200);
const estadoA1 = mapa.asientos.find((a) => a.id === objetivo.id).estado;
const libres = mapa.asientos.filter((a) => a.id !== objetivo.id && a.estado === 'LIBRE').length;

console.table([
  { comprobación: '201 Created', esperado: 1, obtenido: ganadores },
  { comprobación: '409 Conflict', esperado: N - 1, obtenido: conflictos },
  { comprobación: 'otros códigos', esperado: 0, obtenido: otros },
  { comprobación: 'A1 en el mapa', esperado: 'RESERVADO', obtenido: estadoA1 },
  { comprobación: 'otros 9 asientos LIBRE', esperado: 9, obtenido: libres },
]);
console.log(`Carrera: ${msCarrera} ms · total: ${Math.round(performance.now() - inicio)} ms`);

const ok = ganadores === 1 && conflictos === N - 1 && estadoA1 === 'RESERVADO' && libres === 9;
console.log(ok ? `\n✓ Exactamente 1 ganó y ${N - 1} recibieron 409. Sin sobreventa.` : '\n✗ La carrera NO dio 1 ganador');
exit(ok ? 0 : 1);
