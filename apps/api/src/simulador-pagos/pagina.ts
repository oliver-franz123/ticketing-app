import { LOCALE, MODOS_SIMULADOR, type ModoSimulador } from '@entradas/shared';

// HTML de la página del simulador (ADR-0015), sin plantillas ni frontend: es
// una pantalla de demo que vive en la API, como el checkout de un proveedor.
// Se ve como una pasarela con el estilo de YaKache; lo técnico (modos de
// prueba) queda plegado al final. Todo lo que viene de la BD o del entorno
// pasa por escapar().

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const bolivianos = (centavos: bigint) =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BOB' }).format(Number(centavos) / 100);

const NOMBRE_MODO: Record<ModoSimulador, string> = {
  OK: 'Aprobado',
  RECHAZO: 'Rechazado',
  DUPLICAR: 'Aviso repetido',
  DEMORA: 'Aviso con demora',
  DESORDEN: 'Avisos en desorden',
};

const DESCRIPCION: Record<ModoSimulador, string> = {
  OK: 'El pago se aprueba y la tienda recibe el aviso.',
  RECHAZO: 'El pago se rechaza. La orden sigue pendiente y se puede reintentar.',
  DUPLICAR: 'El pago se aprueba y el mismo aviso llega a la tienda varias veces a la vez.',
  DEMORA: 'El pago se aprueba, pero el aviso llega a la tienda con retraso.',
  DESORDEN: 'Llega el aviso de aprobado y después uno de rechazo del mismo pago.',
};

// Mismos valores que apps/web/app/tokens.css (contraste AA medido allí).
// Poppins si el equipo la tiene instalada; si no, la fuente del sistema.
const ESTILOS = `
:root {
  --c-acento: #d90f49; --c-acento-hover: #b80d3e; --c-negro: #000; --c-texto: #1a1a1a;
  --c-suave: #4a4a4a; --c-suave-oscuro: #a3a3a3; --c-borde: #e5e5e5; --c-fondo-alt: #f5f5f5;
  --c-ok: #15803d; --c-ok-fondo: #e8f5ec; --c-ok-texto: #166534; --c-error: #b42318; --c-error-fondo: #fdecea;
  --r-md: 8px; --r-full: 999px; --sombra: 0 6px 20px rgb(0 0 0 / .14);
  --foco: 0 0 0 3px #fff, 0 0 0 5px var(--c-acento);
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; font-family: Poppins, system-ui, sans-serif; color: var(--c-texto); background: var(--c-fondo-alt); line-height: 1.5; }
:focus-visible { outline: none; box-shadow: var(--foco); border-radius: var(--r-md); }
header, footer { background: var(--c-negro); color: #fff; }
.franja { max-width: 32rem; margin: 0 auto; padding: 0 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header .franja { min-height: 60px; }
.pasarela { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.pasarela svg { width: 18px; height: 18px; }
header a { color: #fff; font-size: .9rem; font-weight: 500; text-decoration: none; display: inline-flex; align-items: center; min-height: 40px; }
header a:hover { text-decoration: underline; text-underline-offset: 4px; }
main { flex: 1; width: 100%; max-width: 32rem; margin: 0 auto; padding: 32px 16px 48px; }
.tarjeta { background: #fff; border-radius: var(--r-md); box-shadow: var(--sombra); padding: 32px 24px; text-align: center; }
.comercio { margin: 0; color: var(--c-suave); font-weight: 500; }
.monto { margin: 4px 0 8px; font-size: clamp(2.4rem, 11vw, 3.2rem); font-weight: 800; line-height: 1.1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.orden { margin: 0 0 24px; color: var(--c-suave); font-size: .8rem; word-break: break-all; }
.pagar { width: 100%; min-height: 56px; border: 0; border-radius: var(--r-md); background: var(--c-acento); color: #fff; font: inherit; font-size: 1.15rem; font-weight: 600; cursor: pointer; }
.pagar:hover { background: var(--c-acento-hover); }
details { margin-top: 24px; text-align: left; border-top: 1px solid var(--c-borde); padding-top: 16px; }
summary { cursor: pointer; color: var(--c-suave); font-size: .9rem; font-weight: 500; padding: 8px 0; }
fieldset { border: 0; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
legend { font-size: .9rem; font-weight: 600; margin-bottom: 8px; }
.modo { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; padding: 10px 12px; border: 1px solid var(--c-borde); border-radius: var(--r-md); cursor: pointer; }
.modo:has(input:checked) { border-color: var(--c-acento); }
.modo input { grid-row: span 2; margin-top: 5px; accent-color: var(--c-acento); }
.modo strong { font-size: .95rem; font-weight: 600; }
.modo small { color: var(--c-suave); font-size: .8rem; }
.numero { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: .9rem; }
.numero input { width: 6rem; min-height: 40px; padding: 6px 10px; font: inherit; border: 1px solid var(--c-suave-oscuro); border-radius: var(--r-md); }
.estado { width: 64px; height: 64px; margin: 0 auto 12px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; }
.estado svg { width: 32px; height: 32px; }
.estado.ok { background: var(--c-ok-fondo); color: var(--c-ok-texto); }
.estado.error { background: var(--c-error-fondo); color: var(--c-error); }
h1 { margin: 0 0 8px; font-size: 1.5rem; font-weight: 800; }
p { margin: 0 0 16px; }
.volver { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 24px; border-radius: var(--r-md); background: var(--c-acento); color: #fff; font-weight: 600; text-decoration: none; }
.volver:hover { background: var(--c-acento-hover); }
footer .franja { justify-content: center; min-height: 56px; color: var(--c-suave-oscuro); font-size: .8rem; text-align: center; }
`;

const CANDADO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>`;
const EQUIS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

// "Volver a YaKache": la arma el controlador con WEB_PUBLIC_URL (la orden si
// se conoce). Solo http(s): una URL mal configurada no se convierte en enlace.
const urlTienda = (url?: string) => (url && /^https?:\/\//.test(url) ? url : null);

const documento = (titulo: string, cuerpo: string, volver?: string) => {
  const url = urlTienda(volver);
  return `<!doctype html>
<html lang="es-BO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<title>${escapar(titulo)}</title>
<style>${ESTILOS}</style>
</head>
<body>
<header><div class="franja">
<span class="pasarela">${CANDADO} Pasarela de pagos</span>
${url ? `<a href="${escapar(url)}">Volver a YaKache</a>` : ''}
</div></header>
<main>
${cuerpo}
</main>
<footer><div class="franja">Entorno de pruebas · no se realizan cobros reales</div></footer>
</body>
</html>`;
};

export function paginaDePago(pago: { referencia: string; montoCentavos: bigint }, volver?: string): string {
  const monto = escapar(bolivianos(pago.montoCentavos));
  // Solo modo, veces y s: los tres campos que declara el DTO. Con
  // forbidNonWhitelisted, cualquier otro input (incluido un name en el botón) daría 400.
  const opciones = MODOS_SIMULADOR.map(
    (modo) => `<label class="modo"><input type="radio" name="modo" value="${modo}"${modo === 'OK' ? ' checked' : ''}>
  <strong>${escapar(NOMBRE_MODO[modo])}</strong><small>${escapar(DESCRIPCION[modo])}</small></label>`,
  ).join('\n');

  return documento(
    'Pagar a YaKache',
    `<form class="tarjeta" method="post" action="/simulador/pagar/${encodeURIComponent(pago.referencia)}">
<p class="comercio">Pagar a YaKache</p>
<p class="monto">${monto}</p>
<p class="orden">Orden · ${escapar(pago.referencia)}</p>
<button class="pagar" type="submit">Pagar ${monto}</button>
<details>
<summary>Opciones de la demo</summary>
<fieldset>
<legend>Respuesta de la pasarela</legend>
${opciones}
</fieldset>
<label class="numero">Copias del aviso (Aviso repetido, de 2 a 10) <input type="number" name="veces" min="2" max="10" value="5"></label>
<label class="numero">Segundos de demora (Aviso con demora, de 1 a 600) <input type="number" name="s" min="1" max="600" value="120"></label>
</details>
</form>`,
    volver,
  );
}

// Después de confirmar: la pasarela NO confirma nada en la tienda. La orden
// cambia cuando llega el webhook (doc 05 §4: el navegador nunca confirma un pago).
export function paginaEnviado(modo: ModoSimulador, volver?: string): string {
  const rechazado = modo === 'RECHAZO';
  return documento(
    rechazado ? 'Pago rechazado' : 'Pago aprobado',
    `<div class="tarjeta">
<div class="estado ${rechazado ? 'error' : 'ok'}">${rechazado ? EQUIS : CHECK}</div>
<h1>${rechazado ? 'Pago rechazado' : 'Pago aprobado'}</h1>
<p>${
      rechazado
        ? 'No se realizó ningún cobro. Vuelve a YaKache para intentarlo de nuevo mientras tu reserva siga vigente.'
        : 'Vuelve a YaKache: tu orden se actualizará en cuanto la tienda reciba la confirmación.'
    }</p>
${urlTienda(volver) ? `<a class="volver" href="${escapar(urlTienda(volver)!)}">Volver a YaKache</a>` : ''}
</div>`,
    volver,
  );
}

export function paginaYaProcesado(volver?: string): string {
  return documento(
    'Pago ya procesado',
    `<div class="tarjeta">
<div class="estado ok">${CHECK}</div>
<h1>Este pago ya fue procesado</h1>
<p>No se puede pagar dos veces. Vuelve a YaKache para ver el estado de tu orden.</p>
${urlTienda(volver) ? `<a class="volver" href="${escapar(urlTienda(volver)!)}">Volver a YaKache</a>` : ''}
</div>`,
    volver,
  );
}
