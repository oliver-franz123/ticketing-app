# ADR-0011 — QR firmado con Ed25519, sin datos personales

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Hay que evitar entradas falsificadas, minimizar datos personales y tolerar a futuro la mala conectividad en la puerta.

## Opciones consideradas
1. QR con solo un UUID (sin firma) que se consulta a la BD.
2. QR firmado con HMAC.
3. QR firmado con **Ed25519** (asimétrico).

## Decisión
**Opción 3.** Formato `TKT1.<payload>.<firma>`, con payload `{t: uuid_entrada, e: evento_id, i: emitida}`. La clave privada vive **solo en el Worker** y la API tiene la pública. La autenticidad se puede verificar sin red (base para un modo offline futuro), pero la marca USADA siempre se hace en línea con CAS (`WHERE estado='EMITIDA'`).
Con HMAC, quien verifica también puede firmar.

## Consecuencias
- ➕ Infalsificable y sin datos personales. Privilegio mínimo.
- ➖ Rotar la clave invalida los QR emitidos, salvo que se mantenga un identificador de clave (`kid`) en el payload (previsto en el prefijo `TKT1`).
