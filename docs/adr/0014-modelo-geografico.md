# ADR-0014 — Modelo geográfico departamento → ciudad → recinto

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Lanzamiento en Cochabamba y expansión a los 9 departamentos sin rediseñar.

## Opciones consideradas
1. Campo de texto `ciudad` en el evento.
2. Tablas `departamentos` (código CB, LP, SC, OR, PT, CH, TJ, BE, PD) → `ciudades` (slug) → `recintos` → `eventos`.

## Decisión
**Opción 2.** Filtro `?ciudad=<slug>` o `?departamento=<código>`. Agregar una región es insertar filas (RNF-14).

## Consecuencias
- ➕ Datos limpios y filtros fiables. Base para métricas por departamento.
- ➖ Un JOIN más en el listado (con índices, despreciable).
