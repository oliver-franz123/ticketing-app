# ADR-0010 — Dinero en centavos BOB y fechas en UTC

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Moneda boliviana (BOB). Zona horaria `America/La_Paz` (UTC-4, sin horario de verano). Servidores en UTC.

## Opciones consideradas
- Dinero: `float`, `numeric(12,2)` o **entero en centavos**.
- Fechas: hora local sin zona o **`timestamptz` en UTC**.

## Decisión
`bigint` en centavos + `moneda char(3) = 'BOB'`, y en JSON `totalCentavos`. `timestamptz` en UTC, vencimientos comparados con `now()` de Postgres y conversión a `America/La_Paz` solo en la presentación (frontend, PDF y email) con `Intl` y `es-BO`.
`numeric` sería correcto en la BD, pero en JS se convierte a `number` (float) o a string: los enteros evitan errores de redondeo en todo el camino.

## Consecuencias
- ➕ Sumas exactas y sin ambigüedad horaria.
- ➖ Hay que formatear siempre (`15050` → `Bs 150,50`). Un helper compartido en `packages/shared`.
