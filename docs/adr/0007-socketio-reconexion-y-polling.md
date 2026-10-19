# ADR-0007 — Socket.IO (solo websocket) con fallback a polling REST

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Usuarios en 4G con latencia variable y microcortes. Varias instancias de la API.

## Opciones consideradas
1. WebSocket nativo (`ws`) con reconexión propia.
2. Socket.IO con long-polling incluido (requiere sticky sessions con varias instancias).
3. Socket.IO con `transports:['websocket']` + `@socket.io/redis-adapter` + **polling REST propio** (`?desdeVersion=`) como respaldo.
4. SSE.

## Decisión
**Opción 3.** La reconexión con backoff y jitter, las salas y el adaptador Redis vienen hechos. El polling REST no tiene estado (funciona con cualquier instancia y sin sticky sessions). Versionado para resincronizar tras cortes. Coalescing de 250 ms y salas por zona contra el fan-out.

## Consecuencias
- ➕ Robusto en redes móviles. Escala horizontalmente.
- ➖ Dos rutas de actualización en el cliente (WS y polling) que hay que probar.
