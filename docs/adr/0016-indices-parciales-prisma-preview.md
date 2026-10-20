# ADR-0016 — Índices parciales con la preview `partialIndexes` de Prisma

- **Estado:** Aceptado · **Fecha:** 2026-10-20
- **Precisa a:** [ADR-0013](0013-prisma-con-sql-explicito.md) (solo en dónde se declaran los índices parciales; el resto sigue igual)

## Contexto
ADR-0013 decía que los índices parciales iban como SQL manual en la migración. El problema: Prisma introspecta los índices de la base. Si un índice existe en Postgres pero no en `schema.prisma`, `prisma migrate diff` (nuestro `db:check`) propone un `DROP INDEX` falso, y la próxima `migrate dev` lo borraría. Entre esos índices está `ux_entrada_valida_por_asiento`, que protege RN-01.

Prisma 7.10.1 trae la preview `partialIndexes`: `@@index([...], where: raw("..."))` y `@@unique([...], where: raw("..."))`.

## Opciones consideradas
1. SQL manual sin declararlo en el schema y filtrar los DROP esperados en `db:check` (frágil: el script tiene que saber qué diferencias son «falsas»).
2. SQL manual + `@@index(map:)` sin `where` (el engine compara el predicado y la unicidad: da drift).
3. Preview `partialIndexes`: Prisma conoce el predicado y genera el `CREATE INDEX ... WHERE`.

## Decisión
**Opción 3.** Los CHECK, las extensiones y los triggers siguen como SQL manual (Prisma no los introspecta, así que no generan drift). Reglas, comprobadas en un spike contra Postgres 16:
- El predicado se escribe **en la forma normalizada que devuelve Postgres** (`pg_indexes.indexdef`). Prisma compara el texto: `estado IN ('A','B')` da drift, y `estado = ANY (ARRAY['A'::text, 'B'::text])` no. `estado = 'A'` e `IS NULL` sí se pueden escribir tal cual.
- En la migración, cada índice parcial queda marcado con el comentario `-- Índice parcial (preview partialIndexes): ...`.

## Consecuencias
- ➕ `db:check` es solo `prisma migrate diff` y queda en 0 sin excepciones.
- ➖ Es una preview: puede cambiar en una versión mayor (Prisma 8). Si cambia, se vuelve a la opción 1.
- ➖ Un `@@unique` parcial aparece en el `WhereUniqueInput` del cliente: `findUnique({ where: { asientoId } })` compila aunque puede haber varias filas (por ejemplo, entradas ANULADAS). **Regla:** no usar `findUnique` por esas claves. Las consultas que las tocan (reservar, webhook) son SQL explícito por ADR-0013.
