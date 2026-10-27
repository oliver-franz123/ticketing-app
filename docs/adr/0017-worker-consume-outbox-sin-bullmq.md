# ADR-0017 — El Worker consume el outbox directamente, sin BullMQ (por ahora)

- **Estado:** Aceptado · **Fecha:** 2026-10-27
- **Reemplaza parcialmente a:** [ADR-0005](0005-outbox-transaccional.md) (se mantiene el outbox transaccional; cambia quién lo lee: ya no hay relay en la API hacia BullMQ, lo lee el Worker)

## Contexto
ADR-0005 pone un *relay* en la API que lee el outbox cada 500 ms y lo publica en BullMQ con `jobId = outbox-<id>`; el Worker consume BullMQ. Son dos saltos (outbox → Redis → Worker) y dos mecanismos de deduplicación (`jobId` y `envios_email`).

El slice mínimo del Worker (semana 4) solo necesita: consumir las filas pendientes, emitir QR + PDF + email una vez por orden y tolerar la caída del Worker. Lo que BullMQ aporta por encima de eso (reintentos con backoff distintos por tipo de job, cola de fallidos, Bull Board, jobs repetibles) quedó **fuera del alcance** de este slice.

## Opciones consideradas
1. Relay en la API + BullMQ, como dice ADR-0005.
2. **El Worker lee el outbox directamente:** reclama filas con `FOR UPDATE SKIP LOCKED` y un *lease* (`outbox.reclamado_hasta`), igual que `despacharPendientes()` del simulador de pagos.
3. Que el Worker escanee las tablas de negocio (`ordenes` PAGADAS sin email) sin outbox.

## Decisión
**Opción 2.** El outbox ya es una cola durable en Postgres: la intención se escribe en la misma transacción que el pago (eso no cambia) y el Worker la procesa **al menos una vez**.
- **Reclamo:** una sola sentencia `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) ... RETURNING` marca `reclamado_hasta = now() + 120 s`. El trabajo lento (PDF, SMTP) va fuera de la transacción.
- **Éxito:** `publicado_en = now()`. **Cambia el significado de la columna:** ya no es "publicado en BullMQ", sino "procesado con éxito". Se mantiene el nombre para no migrar.
- **Fallo o caída a medias:** no se toca la fila; al vencer el lease la vuelve a tomar otro Worker (o el mismo al reiniciar). No hay backoff ni cola de fallidos. `intentos` queda como dato visible.
- **Efecto una vez:** `envios_email` PK `(orden_id, tipo)`, como antes (doc 05 §5).

La opción 3 se descarta porque mezcla "qué hay que hacer" con el estado de negocio, y cada tipo nuevo de trabajo exigiría otra consulta de escaneo.

### Redis y BullMQ: diferidos, no eliminados
- **Redis se mantiene** en docker compose, en CI y en Fly. Sigue haciendo falta para el adaptador de Socket.IO entre instancias (ADR-0007, doc 05 §3) y para los contadores del rate limit.
- **BullMQ queda diferido.** No se instala en este slice porque nada de lo que aporta está en el alcance, y el outbox con lease ya da al-menos-una-vez sin otro salto ni otra fuente de deduplicación.
- **Se reincorpora si pasa alguna de estas cosas:**
  1. Se necesitan reintentos diferenciados por tipo (`enviar-email` 8 intentos frente a `emitir-pdf` 5, doc 05 §7) o distinguir errores transitorios de permanentes del proveedor de email (W-05, W-06).
  2. Se necesita un panel de fallidos con reintento manual (Bull Board).
  3. El volumen hace que el polling a Postgres tenga un costo medible.

  En ese caso, el reclamador del outbox del Worker pasa a ser el relay y publica con `jobId = outbox-<id>`, como en ADR-0005. **La API no cambia:** sigue escribiendo la misma fila en la misma transacción.

## Consecuencias
- ➕ Un componente menos en el camino crítico de la emisión: con Redis caído, la venta **y** la emisión siguen (W-03 deja de ser un riesgo de este flujo).
- ➕ Un solo lugar donde mirar lo pendiente: `SELECT count(*) FROM outbox WHERE publicado_en IS NULL`.
- ➖ En la demo de la caída del Worker, lo acumulado se ve en la tabla `outbox` (consulta o log), no en Bull Board.
- ➖ El "reintento" es el vencimiento del lease (120 s): sin backoff exponencial y sin un tope de intentos. Una fila que falla siempre se reintenta cada 120 s, visible en `intentos`.
- ➖ Polling constante y liviano a Postgres desde el Worker (1 consulta por segundo, servida por el índice parcial `ix_outbox_pendientes`).
- ➖ Igual que antes, si el Worker muere entre el envío SMTP y marcar `ENVIADO`, puede salir un email duplicado (riesgo aceptado, doc 05 §5).
- ➖ **Carrera aceptada y no cerrada:** si existieran dos filas `ENTRADAS_EMITIDAS` de la **misma orden** y dos Workers las procesaran a la vez, los dos verían `envios_email` en PENDIENTE y saldrían dos emails. Hoy no ocurre: la API inserta una sola fila por orden, porque la orden pasa a PAGADA una sola vez (`UPDATE ... WHERE estado IN ('PENDIENTE_PAGO','EXPIRADA')` en la transacción del webhook). Cerrarla exigiría un lease también en `envios_email`, que no se agrega: el costo de un duplicado es bajo (la entrada es la misma) y la causa no puede darse con el código actual. Si algún flujo empieza a insertar más de una fila por orden (por ejemplo, un "reenviar entradas"), hay que revisar esta decisión.
