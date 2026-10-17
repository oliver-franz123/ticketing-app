# ADR-0009 — Autenticación propia con JWT en NestJS

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Necesitamos roles (COMPRADOR, ORGANIZADOR, VALIDADOR, ADMIN) y que la autenticación forme parte de lo que se demuestra. Supabase se usa solo como Postgres.

## Opciones consideradas
1. Supabase Auth.
2. Auth propia: email + contraseña (argon2id) + JWT (HS256) con `sub`, `rol` y `exp` (≤ 60 min).
3. Sesiones en servidor (Redis).

## Decisión
**Opción 2.** Sin estado en el servidor (escala horizontalmente) y guards de rol en NestJS. El token se envía como `Authorization: Bearer` y viaja en el handshake del WS. Se guarda en memoria y en `sessionStorage` en el cliente (simple, vence pronto). En producción conviene una cookie httpOnly same-site entre los subdominios `app.` y `api.`.
Sin refresh tokens ni recuperación de contraseña (fuera de alcance).

## Consecuencias
- ➕ Simple y demostrable, sin acoplarse al proveedor de BD.
- ➖ Un JWT no se puede revocar antes de su `exp` (aceptable con 60 min). Riesgo XSS si el token está en `sessionStorage`: se mitiga con CSP y sin HTML inyectado.
