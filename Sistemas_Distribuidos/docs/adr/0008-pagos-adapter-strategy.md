# ADR-0008 — Pagos detrás de un puerto con tres adaptadores

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Stripe no admite comercios bolivianos (stripe.com/global: en LATAM solo Brasil y México). En producción se usaría un QR interoperable bancario. Para la demo necesitamos un proveedor real y fallos reproducibles.

## Opciones consideradas
1. Integrar Stripe directamente en el servicio de órdenes.
2. Puerto `ProveedorPago` + adaptadores (Adapter), elegidos por configuración (Strategy).

## Decisión
**Opción 2** con `StripeTestAdapter` (solo modo test, la API no arranca con `sk_live_`), `SimuladorAdapter` (OK, rechazo, duplicar ×N, demora y desorden) y `QrBancarioAdapter` (diseñado, futuro). Todos producen un `EventoPagoNormalizado`, y la lógica idempotente es única.

## Consecuencias
- ➕ Cambiar de proveedor = escribir un adaptador. Los fallos se demuestran de forma determinista.
- ➖ La interfaz podría necesitar ajustes cuando se conozca la API real del banco (callback vs. consulta, firma). `consultarEstado` ya prevé la reconciliación.
