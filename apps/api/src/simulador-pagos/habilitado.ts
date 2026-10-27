// ¿Se monta el módulo SimuladorPagos? Solo con SIMULADOR_HABILITADO=true
// exacto (ADR-0015). Cualquier otra cosa (ausente, vacía, "TRUE", " true ")
// lo deja fuera: ante la duda, un "proveedor" que confirma pagos sin dinero
// no existe.
//
// Es una función y no el nombre de la variable porque, con el nombre,
// ConditionalModule.registerWhen monta el módulo también cuando la variable
// NO existe: solo lo omite con "false".
export function simuladorHabilitado(env: NodeJS.ProcessEnv): boolean {
  return env.SIMULADOR_HABILITADO === 'true';
}
