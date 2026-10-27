# Registro de decisiones de arquitectura (ADR)

Cada ADR documenta **una** decisión: el contexto, las opciones, la decisión tomada y sus consecuencias. Son cortos a propósito.

**Estados:** Propuesto · Aceptado · Reemplazado por ADR-XXXX.
**Regla:** un ADR aceptado no se edita. Si la decisión cambia, se escribe uno nuevo que lo reemplaza.

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-monolito-modular-y-worker.md) | Monolito modular NestJS + Worker separado | Aceptado |
| [0002](0002-postgres-fuente-de-verdad-update-condicional.md) | Postgres decide quién gana el asiento (UPDATE condicional) | Aceptado |
| [0003](0003-expiracion-reserva.md) | Reserva de 5 min con `expires_at` + expiración perezosa + job | Aceptado |
| [0004](0004-idempotencia-webhook.md) | Webhook idempotente con restricción única | Aceptado |
| [0005](0005-outbox-transaccional.md) | Outbox transaccional para encolar trabajos | Reemplazado parcialmente por ADR-0017 |
| [0006](0006-comunicacion-hibrida-sin-graphql.md) | REST + WebSocket + cola. GraphQL descartado | Aceptado |
| [0007](0007-socketio-reconexion-y-polling.md) | Socket.IO, solo websocket, con fallback a polling REST | Aceptado |
| [0008](0008-pagos-adapter-strategy.md) | Pagos detrás de un puerto con 3 adaptadores | Reemplazado parcialmente por ADR-0015 |
| [0009](0009-auth-propia-jwt.md) | Auth propia con JWT en NestJS | Aceptado |
| [0010](0010-dinero-centavos-y-fechas-utc.md) | Dinero en centavos BOB y fechas en UTC | Aceptado |
| [0011](0011-qr-firmado-ed25519.md) | QR firmado con Ed25519 sin datos personales | Aceptado |
| [0012](0012-despliegue-fly-gru-supabase.md) | Vercel + Fly.io gru + Supabase sa-east-1 + Redis en Fly + Resend | Aceptado |
| [0013](0013-prisma-con-sql-explicito.md) | Prisma como ORM, con SQL explícito en las consultas críticas | Aceptado |
| [0014](0014-modelo-geografico.md) | Departamento → ciudad → recinto para la expansión nacional | Aceptado |
| [0015](0015-simulador-de-pagos-principal.md) | Simulador de pagos propio (módulo del backend) como proveedor principal; Stripe test opcional | Aceptado |
| [0016](0016-indices-parciales-prisma-preview.md) | Índices parciales con la preview `partialIndexes` de Prisma | Aceptado |
| [0017](0017-worker-consume-outbox-sin-bullmq.md) | El Worker consume el outbox con SKIP LOCKED + lease; BullMQ diferido | Aceptado |

Plantilla: [`plantilla.md`](plantilla.md)
