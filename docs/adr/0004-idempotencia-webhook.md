# ADR-0004 — Webhook de pago idempotente

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Los proveedores entregan webhooks al menos una vez y pueden duplicarlos, reordenarlos o retrasarlos. Un cobro duplicado no puede generar dos entradas.

## Opciones consideradas
1. Comprobar con un SELECT si ya se procesó.
2. Tabla `webhook_eventos` con `UNIQUE(proveedor, evento_externo_id)` + `INSERT ... ON CONFLICT DO NOTHING` **en la misma transacción** que emite las entradas.
3. Deduplicar en Redis.

## Decisión
**Opción 2**, más `pagos UNIQUE(proveedor, referencia_externa)` y transiciones condicionales de la orden (`WHERE estado IN ('PENDIENTE_PAGO','EXPIRADA')`). Se responde **200** a los duplicados. Un `FALLIDO` posterior no revierte una orden PAGADA. Se verifican la firma (sobre el raw body), el monto y la moneda.
La opción 1 tiene una carrera entre dos webhooks simultáneos, y la 3 tiene una fuente de verdad fuera de la transacción.

## Consecuencias
- ➕ Efecto "exactamente una vez" sobre una entrega "al menos una vez". Probado con el simulador (×5 en paralelo).
- ➖ La tabla crece: se purgan los registros de más de 90 días (más allá de la ventana de reintentos del proveedor).
