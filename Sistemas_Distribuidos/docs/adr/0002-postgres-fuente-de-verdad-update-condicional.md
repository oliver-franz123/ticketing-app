# ADR-0002 — Postgres decide quién gana el asiento (UPDATE condicional)

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Miles de peticiones concurrentes por los mismos asientos, desde varias instancias de la API. Invariante: un asiento tiene como máximo una entrada válida.

## Opciones consideradas
1. UPDATE condicional atómico (`WHERE estado='LIBRE'`), es decir compare-and-set.
2. Bloqueo pesimista (`SELECT FOR UPDATE` mientras el usuario paga).
3. Lock distribuido en Redis (Redlock).
4. Serializar las reservas en una cola por evento.

## Decisión
**Opción 1**, en una sola sentencia con `ORDER BY id FOR UPDATE SKIP LOCKED` para varios asientos (todo o nada y sin deadlocks), más **restricciones únicas** como segunda red (índice único parcial de entradas válidas por asiento).
- No pesimista: mantener locks durante minutos agota las conexiones y bloquea usuarios.
- No Redlock: crea dos fuentes de verdad y no es seguro ante pausas sin fencing tokens, que igual dependen de la BD.
- No cola única: latencia alta y punto único de fallo.

## Consecuencias
- ➕ Correctitud garantizada por Postgres. El perdedor recibe 409 en milisegundos.
- ➖ Un raro 409 "falso" si la transacción que tenía el lock termina en rollback (SKIP LOCKED). Aceptado.
- ➖ Postgres es el cuello de botella al escalar: se mitiga con escalado vertical y transacciones cortas.
