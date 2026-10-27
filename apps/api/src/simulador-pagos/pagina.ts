import { LOCALE, MODOS_SIMULADOR, type ModoSimulador } from '@entradas/shared';

// HTML de la página del simulador (ADR-0015), sin plantillas ni frontend: es
// una pantalla de demo que vive en la API, como el checkout de un proveedor.
// Todo lo que viene de la BD pasa por escapar(), aunque hoy sean solo una
// referencia en hex y un monto.

const escapar = (texto: string) =>
  texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const bolivianos = (centavos: bigint) =>
  new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'BOB' }).format(Number(centavos) / 100);

const DESCRIPCION: Record<ModoSimulador, string> = {
  OK: 'Pago aprobado: un webhook pago.exitoso.',
  RECHAZO: 'Pago rechazado: un webhook pago.fallido. La orden sigue pendiente y se puede reintentar.',
  DUPLICAR: 'Pago aprobado, y el MISMO webhook se envía varias veces en paralelo (idempotencia, P-01).',
  DEMORA: 'Pago aprobado, pero el webhook llega tarde (pago tardío, P-03 / P-04).',
  DESORDEN: 'pago.exitoso y después pago.fallido del mismo pago (desorden, P-05).',
};

const documento = (titulo: string, cuerpo: string) => `<!doctype html>
<html lang="es-BO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
  .aviso { background: #fff4ce; border: 1px solid #e0c060; padding: .5rem .75rem; border-radius: .375rem; }
  .monto { font-size: 2rem; font-weight: 700; margin: .5rem 0 1.5rem; }
  label { display: block; margin: .5rem 0; }
  small { display: block; color: #555; margin-left: 1.5rem; }
  input[type=number] { width: 5rem; }
  button { margin-top: 1.25rem; padding: .6rem 1.2rem; font-size: 1rem; }
</style>
</head>
<body>
${cuerpo}
</body>
</html>`;

export function paginaDePago(pago: { referencia: string; montoCentavos: bigint }): string {
  // Solo modo, veces y s: los tres campos que declara el DTO. Con
  // forbidNonWhitelisted, cualquier otro input (incluido un name en el botón) daría 400.
  const opciones = MODOS_SIMULADOR.map(
    (modo) => `<label><input type="radio" name="modo" value="${modo}"${modo === 'OK' ? ' checked' : ''}> ${modo}
  <small>${escapar(DESCRIPCION[modo])}</small></label>`,
  ).join('\n');

  return documento(
    'Simulador de pagos',
    `<p class="aviso">Simulador de pagos: no se cobra dinero real.</p>
<h1>Pagar</h1>
<p class="monto">${escapar(bolivianos(pago.montoCentavos))}</p>
<p>Referencia: <code>${escapar(pago.referencia)}</code></p>
<form method="post" action="/simulador/pagar/${encodeURIComponent(pago.referencia)}">
<fieldset>
<legend>¿Qué hace el proveedor?</legend>
${opciones}
</fieldset>
<label>Copias del webhook (DUPLICAR, de 2 a 10): <input type="number" name="veces" min="2" max="10" value="5"></label>
<label>Segundos de demora (DEMORA, de 1 a 600): <input type="number" name="s" min="1" max="600" value="120"></label>
<button type="submit">Confirmar</button>
</form>`,
  );
}

// Después de confirmar: el simulador NO confirma nada en la tienda. La orden
// cambia cuando llega el webhook (doc 05 §4: el navegador nunca confirma un pago).
export function paginaEnviado(modo: ModoSimulador): string {
  return documento(
    'Pago enviado',
    `<p class="aviso">Simulador de pagos: no se cobra dinero real.</p>
<h1>Listo</h1>
<p>Modo <strong>${escapar(modo)}</strong>. El aviso al comercio se envía en segundo plano.</p>
<p>Ya puede volver a la tienda: su orden se actualizará cuando el comercio reciba el aviso.</p>`,
  );
}

export function paginaYaProcesado(): string {
  return documento(
    'Pago ya procesado',
    `<p class="aviso">Simulador de pagos: no se cobra dinero real.</p>
<h1>Este pago ya fue procesado</h1>
<p>No se puede confirmar dos veces. Vuelva a la tienda para ver el estado de su orden.</p>`,
  );
}
