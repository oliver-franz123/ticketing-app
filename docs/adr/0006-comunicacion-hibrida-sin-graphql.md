# ADR-0006 — Comunicación híbrida: REST + WebSocket + cola. Sin GraphQL

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Hay acciones con respuesta (reservar, pagar), estado en vivo (mapa) y trabajo lento (PDF, email).

## Opciones consideradas
1. Todo REST con polling.
2. REST + WebSocket (solo informa) + cola.
3. GraphQL con suscripciones.
4. gRPC.

## Decisión
**Opción 2.** REST para las acciones (códigos HTTP, idempotencia, rate limit por ruta, caché en CDN). WebSocket **solo** para los deltas del mapa. Cola para el trabajo asíncrono.
GraphQL: pocos endpoints fijos y un solo cliente, el caché HTTP y el rate limit se complican, y las suscripciones no resuelven el escalado del WS. gRPC: no corre nativo en el navegador.

## Consecuencias
- ➕ Cada canal hace una cosa. Perder el WS no afecta la correctitud.
- ➖ Tres mecanismos que aprender y monitorear.
