# ADR-0005 — Outbox transaccional

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Al confirmar el pago hay que guardar en Postgres **y** encolar en Redis. No existe una transacción común (doble escritura).

## Opciones consideradas
1. Encolar después del COMMIT y aceptar el riesgo.
2. Outbox + relay con polling.
3. CDC (Debezium sobre el WAL).

## Decisión
**Opción 2.** Fila `outbox` en la misma transacción. El relay vive **en la API** (cada 500 ms, `FOR UPDATE SKIP LOCKED`) y publica con `jobId = outbox-<id>` para deduplicar en BullMQ. Si Redis cae, las filas esperan. Con el Worker caído, los jobs se acumulan en Redis (visibles en la demo).
CDC es más eficiente pero exige infraestructura que no aporta valor a esta escala.

## Consecuencias
- ➕ Ningún pago confirmado se queda sin su email. Tolerancia a la caída de Redis y del Worker.
- ➖ Latencia extra de ~0,5 s en el inicio del job (irrelevante para un email). Polling constante y liviano a la BD.
