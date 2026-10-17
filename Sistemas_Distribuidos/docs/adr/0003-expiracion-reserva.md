# ADR-0003 — Reserva de 5 min: `expires_at` + expiración perezosa + job

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
La reserva tipo carrito debe vencer a los 5 minutos aunque el usuario cierre la pestaña o el Worker esté caído.

## Opciones consideradas
1. Solo un job que libera las vencidas.
2. TTL en Redis + evento de expiración.
3. `expires_at` en la fila + **expiración perezosa** (la consulta trata como libre una reserva vencida) + job de limpieza.

## Decisión
**Opción 3.** La correctitud no depende del job: reservar y el snapshot usan `expires_at < now()` de Postgres. El job (cada 15 s, `SKIP LOCKED`, lotes de 500) solo limpia, marca las órdenes EXPIRADAS y notifica el mapa. Al iniciar el pago se extiende +2 min **una sola vez**.
Los eventos de expiración de Redis no están garantizados (se pierden si no hay suscriptor conectado).

## Consecuencias
- ➕ Con el Worker caído se sigue vendiendo correctamente.
- ➖ El estado almacenado puede decir RESERVADO cuando efectivamente está LIBRE: todas las lecturas deben usar el `estado_efectivo`.
- 🔄 El TTL debería ser configurable por proveedor (QR bancario ≈ 10 min, ver doc 13).
