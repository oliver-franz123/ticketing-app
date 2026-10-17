# ADR-0013 — Prisma como ORM, con SQL explícito en las consultas críticas

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Necesitamos migraciones versionadas, tipos en TypeScript y control total del SQL de concurrencia.

## Opciones consideradas
1. TypeORM (el habitual en NestJS).
2. Prisma.
3. Kysely o SQL puro.

## Decisión
**Prisma** para el CRUD y las migraciones. Las consultas de reservar, confirmar, expirar, el relay del outbox y validar se escriben en **SQL explícito** (`$queryRaw` con parámetros) dentro de `prisma.$transaction`, encapsuladas en repositorios. Los índices parciales, los CHECK y `citext` van como SQL manual en las migraciones. Runtime contra el pooler de Supabase en modo transacción (`pgbouncer=true`). Migraciones con `DIRECT_URL` (modo sesión).

## Consecuencias
- ➕ Productividad y tipos, sin ocultar el SQL que hay que defender ante el docente.
- ➖ Compatibilidad entre Prisma y el pooler en modo transacción: hay que probarla en la semana 1.
