# ADR-0015 — Simulador de pagos propio como proveedor principal; Stripe test opcional

- **Estado:** Aceptado · **Fecha:** 2026-10-18
- **Reemplaza parcialmente a:** [ADR-0008](0008-pagos-adapter-strategy.md) (se mantienen el puerto `ProveedorPago` y el patrón Adapter + Strategy; cambia qué adaptador es el principal)

## Contexto
ADR-0008 presentaba a `StripeTestAdapter` como el proveedor "real" de la demo y al simulador como complemento. Pero Stripe no admite comercios bolivianos (stripe.com/global), y **ni siquiera es seguro que podamos abrir una cuenta de test desde Bolivia**: el registro pide elegir un país soportado. Si la demo depende de Stripe y la cuenta no se puede crear, perdemos el flujo de pago entero. Lo que la materia evalúa es la **confirmación asíncrona, firmada e idempotente**, y eso no depende de qué proveedor la envíe.

## Opciones consideradas
1. Stripe test como principal y el simulador como complemento (lo que decía ADR-0008).
2. **Simulador propio como principal** y Stripe test como adaptador opcional.
3. Solo el simulador, sin Stripe en ningún caso.

## Decisión
**Opción 2.** El proveedor por defecto es el simulador (`PAYMENT_PROVIDER_DEFAULT=simulador`). `StripeTestAdapter` queda como tarea opcional de la semana 4, **solo si** se confirma que se puede abrir la cuenta de test. `QrBancarioAdapter` sigue siendo el futuro para producción en Bolivia (doc 13).

**Dónde vive:** un **módulo `SimuladorPagos` dentro de la API NestJS**, con sus rutas (`/simulador/*`), su página de pago y su firma HMAC. No es una app aparte: así no hay otro despliegue, otro dominio ni más costo.

**Reglas para que se comporte como un proveedor externo:**
- El webhook se envía por **HTTP real** a `POST /webhooks/pagos/simulador`, usando la URL pública de la API (`API_PUBLIC_URL`). Pasa por el proxy de Fly y puede caer en **otra instancia**, igual que un webhook de verdad. Nunca se llama a `PagosService` en memoria.
- **Frontera de módulo:** el simulador no importa servicios de Órdenes/Pagos ni toca sus tablas. Es dueño solo de la tabla `simulador_pagos`.
- **Estado persistido** en `simulador_pagos` (no en memoria): con N instancias, la página de pago, la confirmación y `consultarEstado` pueden caer en instancias distintas.
- Los envíos pendientes (incluida la `DEMORA`) se guardan con `enviar_en` y los despacha un tick del propio módulo (cada 1 s, `FOR UPDATE SKIP LOCKED`). **No depende del Worker:** la demo de "Worker caído" sigue pudiendo pagar.
- **Reintentos de entrega:** si el endpoint no responde 2xx, reintenta con backoff (5 s, 30 s, 2 min, 10 min), como un proveedor real.
- Se monta solo con `SIMULADOR_HABILITADO=true` (local y demo). Con un proveedor real, el módulo no existe en la API.

**Contrato del webhook:**
- Cabecera `Simulador-Firma: t=<unix>,v1=<hex>`, donde `v1 = HMAC-SHA256(SIMULADOR_WEBHOOK_SECRET, "<t>.<rawBody>")`. Se compara en tiempo constante.
- Tolerancia de **5 min** sobre `t` (contra la repetición de webhooks viejos, *replay*).
- Cuerpo: `{ id: "sim_evt_…", tipo: "pago.exitoso" | "pago.fallido", referencia: "sim_pay_…", ordenId, montoCentavos, moneda: "BOB" }`.
- `GET /simulador/pagos/:referencia` responde el estado para `consultarEstado` (reconciliación).

**Modos de fallo** (elegidos en la página de pago, para la demo y los tests):

| Modo | Efecto | Prueba |
|---|---|---|
| `OK` | 1 webhook `pago.exitoso` | Flujo normal |
| `RECHAZO` | 1 webhook `pago.fallido` | Pago rechazado |
| `DUPLICAR` (`veces=N`) | El mismo evento (mismo `id`) N veces **en paralelo** | P-01, idempotencia |
| `DEMORA` (`s=S`) | El webhook se envía S segundos después | P-03 / P-04, pago tardío |
| `DESORDEN` | `pago.exitoso` y después `pago.fallido` del mismo pago | P-05 |
| `MONTO_ERRONEO` | Monto distinto al de la orden | P-06 |

## Consecuencias
- ➕ La demo no depende de una cuenta externa que quizá no se pueda crear. Los fallos (duplicados, retrasos, desorden) son **deterministas y repetibles** en clase.
- ➕ El Adapter se sigue demostrando: `PagosService.procesarWebhook` solo ve un `EventoPagoNormalizado`, venga del simulador, de Stripe o del banco.
- ➕ **Extraíble más adelante:** como solo se comunica por HTTP y tiene su propia tabla, el módulo puede sacarse a un servicio aparte (otra app de Fly) cambiando solo la URL configurada en `SimuladorAdapter`. Órdenes y Pagos no cambian.
- ➖ No se prueba la integración con un tercero real (sus SDK, sus formatos, su panel). Se atenúa con el webhook por HTTP real, la firma sobre el raw body y la tolerancia de tiempo, que es lo mismo que exige Stripe.
- ➖ El simulador corre dentro de la API: si la API cae, el "proveedor" también cae. Para una demo es aceptable, y es una razón más para extraerlo si el proyecto sigue.
- 🔄 Si se confirma la cuenta de test de Stripe (prueba T11 de la semana 1), se implementa `StripeTestAdapter` en la semana 4 como segundo adaptador, sin cambiar esta decisión.
