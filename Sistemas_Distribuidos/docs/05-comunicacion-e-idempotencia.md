# 05 — Comunicación, idempotencia y pagos

## 1. Tres canales, cada uno para lo que sirve

| Canal | Se usa para | Por qué este canal |
|---|---|---|
| **REST (HTTPS + JSON)** | Login, catálogo, reservar, pagar, mis entradas, validar QR, panel del organizador | Petición-respuesta simple, cacheable (catálogo), fácil de probar con curl, y los códigos HTTP expresan bien el resultado (201, 409, 429) |
| **WebSocket (Socket.IO)** | **Solo** el estado de los asientos en vivo (servidor → cliente) | Empuja cambios sin que el cliente pregunte. Con polling a 1 s, 5.000 usuarios harían 5.000 req/s solo para "¿cambió algo?" |
| **Cola (BullMQ sobre Redis)** | Generar QR + PDF, enviar el email y el job de expiración | Trabajo lento o frágil que **no** debe bloquear al comprador y que necesita reintentos |

**Regla de oro:** el WebSocket **solo informa**, nunca decide. Para reservar siempre se usa `POST /reservas` (REST). Así las acciones importantes tienen respuesta, código de error e `Idempotency-Key`, y el WS se puede perder sin consecuencias.

### ¿Por qué no GraphQL?

- **Problema:** ¿necesitamos un lenguaje de consulta flexible?
- **Opciones:** REST, GraphQL, gRPC.
- **Elección:** REST.
- **Por qué:**
  - Tenemos **pocos endpoints fijos** (≈20). GraphQL rinde cuando hay muchos clientes con necesidades de datos distintas, y nosotros tenemos uno.
  - El **caché HTTP** del catálogo (CDN, `Cache-Control`) es trivial en REST y difícil en GraphQL (todo es `POST /graphql`).
  - El **rate limiting por endpoint** (p. ej. `/reservas`) es directo en REST. En GraphQL habría que analizar la consulta.
  - Las **suscripciones GraphQL** usan WebSocket por debajo. No resuelven el escalado: tendríamos el mismo problema con una capa más encima.
  - Curva de aprendizaje: 6 semanas.
  - gRPC no corre nativamente en el navegador y no tenemos comunicación entre servicios.

## 2. Contrato REST (resumen)

| Método y ruta | Rol | Respuestas clave |
|---|---|---|
| `POST /auth/registro` · `POST /auth/login` | público | 201 / 200 `{token}` · 401 |
| `GET /ciudades` | público | 200 |
| `GET /eventos?ciudad=cochabamba&desde=...` | público | 200 (cache 30 s) |
| `GET /eventos/:id` | público | 200 |
| `GET /eventos/:id/asientos` | público | 200 `{version, asientos:[...]}` (snapshot) |
| `GET /eventos/:id/asientos?desdeVersion=812` | público | 200 `{version, cambios:[...]}` (delta para polling) |
| `POST /eventos/:id/reservas` + `Idempotency-Key` | comprador | 201 `{ordenId, expiresAt, totalCentavos}` · **409** `{noDisponibles}` · 429 |
| `DELETE /ordenes/:id` | comprador (dueño) | 204 |
| `POST /ordenes/:id/pago` | comprador (dueño) | 200 `{proveedor, redirectUrl \| clientSecret}` |
| `POST /webhooks/pagos/:proveedor` | proveedor (firma) | **200** siempre que la firma sea válida (incluso si es duplicado) · 400 si la firma es inválida |
| `GET /mis-entradas` · `GET /entradas/:id/pdf` | comprador | 200 |
| `POST /validaciones` `{qr}` | validador | 200 `{resultado: VALIDA \| YA_USADA \| INVALIDA \| OTRO_EVENTO, usadaEn?}` |
| `POST /admin/eventos` ... | organizador | 201 |

**Formato de dinero:** siempre `{"totalCentavos": 30000, "moneda": "BOB"}`. El frontend formatea `Bs 300,00` con `Intl.NumberFormat('es-BO', {style:'currency', currency:'BOB'})`.
**Formato de fecha:** ISO 8601 en UTC (`2026-11-22T01:00:00Z`). El frontend lo muestra en `America/La_Paz` ("sáb. 21 nov., 21:00").

## 3. WebSocket: protocolo del mapa en vivo

```text
cliente → servidor   "evento:unirse"   {eventoId: 42}
servidor → cliente   "asientos:snapshot" {version: 812, asientos: <compacto>}
servidor → cliente   "asientos:delta"  {desde: 812, hasta: 815, cambios:[{id, estado, v}]}
```

### Versionado y resincronización

- Cada evento tiene un contador `mapa_version`, que se incrementa con cada cambio de asiento.
- El cliente guarda `versionLocal`. Si llega un delta con `desde > versionLocal`, **le falta algo** (se perdió un mensaje), así que pide `GET /asientos?desdeVersion=versionLocal`, o el snapshot completo si la diferencia es grande.
- Así toleramos mensajes **perdidos, duplicados o desordenados** (*consistencia eventual* del cliente).

### Reconexión y respaldo con polling (redes móviles)

```mermaid
stateDiagram-v2
    [*] --> Conectando
    Conectando --> EnVivo: conexión WS OK → pedir snapshot/delta
    EnVivo --> Reconectando: se cae la red / cambio 4G→WiFi
    Reconectando --> EnVivo: reconecta (backoff 0.5s, 1s, 2s... máx 10s + jitter)
    Reconectando --> Polling: 3 intentos fallidos
    Polling --> Polling: GET ?desdeVersion= cada 5 s
    Polling --> Conectando: cada 60 s reintenta WS
    EnVivo --> Polling: pestaña en segundo plano > 2 min (ahorro de batería)
```

- Socket.IO trae reconexión automática con backoff exponencial y *jitter*. El *jitter* (aleatoriedad) evita que 5.000 celulares reconecten **en el mismo milisegundo** tras un microcorte (efecto *thundering herd*).
- Transporte: `transports: ['websocket']`. **No** usamos el long-polling de Socket.IO porque, con varias instancias, exige *sticky sessions*. El respaldo es **nuestro polling REST**, que no tiene estado y funciona con cualquier instancia.
- Tras **cada** reconexión, el cliente pide el delta desde su versión: durante el corte pudo perderse cambios.

### Formato compacto del snapshot

15.000 asientos × `{"id":"...","fila":"F","col":12,"estado":"LIBRE"}` ≈ 900 KB. Inviable en 4G.
**Solución:** la geometría (filas, columnas, zonas) es **estática**, se descarga una vez y se cachea en la CDN. El estado se envía como una cadena con **1 carácter por asiento** en orden fijo (`L`, `R`, `V`, `X`): 15.000 bytes ≈ **3–4 KB con gzip**.

## 4. Flujo completo del pago y el webhook

```mermaid
sequenceDiagram
    autonumber
    actor C as Comprador
    participant FE as Frontend
    participant API as API
    participant PG as Postgres
    participant PP as Proveedor de pago
    participant RD as Redis/BullMQ
    participant WK as Worker
    participant RS as Resend

    C->>FE: "Pagar Bs 300,00"
    FE->>API: POST /ordenes/77/pago
    API->>PG: verifica orden PENDIENTE_PAGO, extiende expires_at +2 min (1 vez)
    API->>PP: crearIntento(orden 77, 30000 centavos, metadata ordenId=77)
    PP-->>API: {referencia: pi_123, redirectUrl}
    API->>PG: INSERT pagos (pi_123, EN_PROCESO)
    API-->>FE: redirectUrl / clientSecret
    C->>PP: Paga (tarjeta de prueba 4242...)
    PP-->>FE: vuelve a /ordenes/77 → "Procesando..." (NO confirma nada)

    PP->>API: POST /webhooks/pagos/stripe (evt_abc, firma)
    API->>API: verificar firma (raw body + secreto)
    API->>PG: BEGIN
    API->>PG: INSERT webhook_eventos (stripe, evt_abc) ON CONFLICT DO NOTHING
    alt 0 filas: ya procesado
        API->>PG: ROLLBACK
        API-->>PP: 200 OK (duplicado ignorado)
    else 1 fila: nuevo
        API->>PG: SELECT orden 77 FOR UPDATE
        API->>PG: UPDATE asientos SET VENDIDO WHERE orden_id=77 AND estado='RESERVADO'
        API->>PG: UPDATE ordenes SET PAGADA · UPDATE pagos SET CONFIRMADO
        API->>PG: INSERT entradas (1 por asiento)
        API->>PG: INSERT outbox (ENTRADAS_EMITIDAS, ordenId=77)
        API->>PG: COMMIT
        API-->>PP: 200 OK
    end

    loop relay del outbox (cada 500 ms)
        API->>PG: SELECT ... FROM outbox WHERE publicado_en IS NULL FOR UPDATE SKIP LOCKED
        API->>RD: queue.add('emitir-pdf', {ordenId:77}, {jobId: 'outbox-981'})
        API->>PG: UPDATE outbox SET publicado_en=now()
    end

    RD->>WK: job emitir-pdf (ordenId 77)
    WK->>PG: leer entradas · firmar QR (Ed25519)
    WK->>WK: generar PDF (es-BO, hora La Paz)
    WK->>RD: queue.add('enviar-email', {ordenId:77}, {jobId:'email-77'})
    RD->>WK: job enviar-email
    WK->>RS: enviar(adjunto PDF, Idempotency-Key: orden-77)
    WK->>PG: UPDATE envios_email SET ENVIADO
    FE->>API: (polling 2 s o WS) GET /ordenes/77 → PAGADA ✅
```

### Detalles que importan

1. **El navegador nunca confirma un pago.** La URL de retorno puede ser falsificada, o el usuario puede cerrar la pestaña. **Solo el webhook firmado** confirma.
2. **Raw body:** la firma de Stripe se calcula sobre el cuerpo **exacto** en bytes. NestJS debe habilitar `rawBody: true` para esa ruta. Si el JSON se parsea y se vuelve a serializar, la firma no coincide.
3. **Responder 200 al duplicado.** Si respondiéramos 4xx/5xx, el proveedor **seguiría reintentando**.
4. **Responder rápido.** Stripe espera una respuesta en pocos segundos. Por eso la transacción del webhook solo hace escrituras en la BD, y el PDF y el email van por la cola.
5. **Verificar el monto.** Si `evento.monto != orden.totalCentavos` o la moneda no coincide: no se emiten entradas, la orden pasa a `REVISION_MANUAL` y se genera una alerta.
6. **Orden de llegada:** un `payment_failed` puede llegar **después** de un `succeeded` (reintentos del proveedor). Regla: una orden PAGADA **no retrocede** por un evento posterior de fallo.

## 5. Idempotencia en cada capa

**Idempotente** = repetir la operación produce el mismo efecto que hacerla una vez.

| Capa | Riesgo de duplicado | Mecanismo |
|---|---|---|
| Cliente → `POST /reservas` | El usuario toca dos veces, o la red reintenta | Header `Idempotency-Key` (UUID v4 del cliente) guardado con la orden: `UNIQUE(usuario_id, idempotency_key)`. Repetir devuelve la misma respuesta |
| Proveedor → webhook | El proveedor reintenta, o el simulador envía a propósito 2–5 veces | `webhook_eventos UNIQUE(proveedor, evento_externo_id)` dentro de la **misma transacción** que emite las entradas |
| Mismo pago con eventos distintos | Dos eventos diferentes (`checkout.session.completed` y `payment_intent.succeeded`) por el mismo cobro | `pagos UNIQUE(proveedor, referencia_externa)` + la orden solo pasa de PENDIENTE a PAGADA una vez (`UPDATE ... WHERE estado IN ('PENDIENTE_PAGO','EXPIRADA')`) |
| Emisión de entradas | Bug o carrera | Índice único parcial por asiento (doc 04) |
| Outbox → cola | El relay publica, cae antes de marcar `publicado_en` y vuelve a publicar | `jobId = 'outbox-<id>'`: BullMQ **ignora** un job con un `jobId` que ya existe |
| Worker → email | El job envía el email y el Worker cae antes de marcarlo como completado, así que BullMQ lo reintenta | Tabla `envios_email UNIQUE(orden_id, tipo)` con estado + `Idempotency-Key` hacia Resend (si el proveedor lo soporta: verificar en su documentación actual). **Sin garantía absoluta:** un email duplicado es un riesgo aceptado y documentado (no hace daño, la entrada es la misma) |
| Validador → `POST /validaciones` | Doble escaneo | `UPDATE ... WHERE estado='EMITIDA'` (doc 04) |

### Al-menos-una-vez + idempotencia = "efectivamente una vez"

Las colas y los webhooks garantizan **al menos una** entrega. "Exactamente una vez" en la red no existe en general. Lo que sí podemos lograr es que **el efecto** ocurra una vez: el mensaje llega 1..N veces, y el consumidor idempotente lo aplica una.

## 6. Outbox transaccional

**Problema (doble escritura):** al confirmar el pago hay que (a) guardar en Postgres y (b) encolar en Redis. No existe una transacción que abarque ambos.
- Si encolamos antes del COMMIT y el COMMIT falla, se envía un email de una entrada que no existe.
- Si encolamos después del COMMIT y la API cae justo entre los dos pasos, se pagó y **nunca** se envía el email.

**Opciones:** 1) aceptar el riesgo · 2) outbox · 3) CDC (Debezium leyendo el WAL) · 4) que el Worker escanee tablas buscando trabajo pendiente.

**Elección:** **outbox** (con polling).
**Por qué:** dentro de la misma transacción se inserta una fila `outbox`. Si hay COMMIT, la intención de encolar es **durable**, y un *relay* la publica después (al menos una vez). CDC sería más eficiente pero exige infraestructura que **no aporta valor** a esta escala.

```mermaid
flowchart LR
    TX["Transacción del webhook<br/>UPDATE asientos · ordenes<br/>INSERT entradas<br/>INSERT outbox"] -->|COMMIT| OB[("outbox<br/>publicado_en = NULL")]
    OB --> RL["Relay (en la API)<br/>cada 500 ms<br/>SKIP LOCKED · lote 100"]
    RL -->|"add(jobId=outbox-id)"| Q[("BullMQ")]
    RL -->|"publicado_en = now()"| OB
    Q --> W["Worker"]
```

Si Redis está caído, el relay falla, la fila sigue con `publicado_en = NULL` y se reintenta en el próximo ciclo. **La venta no se detiene.**

## 7. Reintentos, backoff y cola de fallidos

| Job | Intentos | Backoff | Al agotarse |
|---|---|---|---|
| `emitir-pdf` | 5 | exponencial 5 s, 10 s, 20 s, 40 s, 80 s | Queda en *failed*. Alerta en logs. Botón "reintentar" en Bull Board |
| `enviar-email` | 8 | exponencial 30 s ... (≈ 2 h en total) | *failed* + `envios_email.estado = FALLIDO`. Visible para el organizador |
| `liberar-vencidas` | repetible cada 15 s | — | Si falla una vez, la siguiente corrida lo cubre (y la expiración perezosa protege igual) |

**Errores transitorios vs. permanentes:** un `503` de Resend o un timeout se **reintentan**. Un email inválido (`422`) **no se reintenta**: se marca FALLIDO de inmediato. Reintentar un error permanente solo gasta la cuota (100 emails/día en el plan gratis).

## 8. Pagos detrás de un puerto (Adapter + Strategy)

**Problema:** Stripe no sirve en producción en Bolivia, y el proveedor real (QR bancario) todavía no existe para nosotros. No queremos reescribir Órdenes cuando cambie el proveedor.

**Elección:** un **puerto** (interfaz) en el dominio y un **adaptador** por proveedor. Qué adaptador se usa lo decide la configuración (`PAYMENT_PROVIDER=stripe|simulador|qr`): eso es el patrón Strategy.

```mermaid
classDiagram
    class ProveedorPago {
        <<interface>>
        +nombre: string
        +crearIntento(orden: OrdenParaPago) IntentoPago
        +verificarYNormalizar(headers, rawBody) EventoPagoNormalizado
        +consultarEstado(referencia) EstadoPago
    }
    class EventoPagoNormalizado {
        proveedor: string
        eventoExternoId: string
        referenciaExterna: string
        ordenId: string
        tipo: EXITOSO | FALLIDO
        montoCentavos: bigint
        moneda: "BOB"
    }
    class StripeTestAdapter {
        Checkout Session (modo test)
        verifica Stripe-Signature
    }
    class SimuladorAdapter {
        página propia de "pago"
        firma HMAC
        modos: OK, RECHAZO, DUPLICAR x N, DEMORA s, DESORDEN
    }
    class QrBancarioAdapter {
        FUTURO
        genera QR dinámico vía API bancaria
        callback/consulta del banco
    }
    ProveedorPago <|.. StripeTestAdapter
    ProveedorPago <|.. SimuladorAdapter
    ProveedorPago <|.. QrBancarioAdapter
    class PagosService {
        +iniciarPago(ordenId)
        +procesarWebhook(proveedor, headers, rawBody)
    }
    PagosService --> ProveedorPago : usa
```

- `PagosService.procesarWebhook` **no sabe** de Stripe: recibe un `EventoPagoNormalizado` y aplica las reglas (idempotencia, asientos, entradas, outbox). **Las reglas se prueban una vez** y valen para todos los proveedores.
- **SimuladorAdapter** es clave para la demo y los tests: permite **inyectar fallos** de forma determinista:
  - `?modo=duplicar&veces=5`: envía el mismo webhook 5 veces en paralelo;
  - `?modo=demora&s=400`: el webhook llega después de que venció la reserva;
  - `?modo=desorden`: llega `FALLIDO` después de `EXITOSO`;
  - `?modo=rechazo`: pago rechazado.
- **QrBancarioAdapter (futuro):** genera un QR **dinámico** con monto y referencia. La confirmación llega por *callback* del banco o por consulta periódica (`consultarEstado`). El job de reconciliación usa `consultarEstado` para las órdenes "EN_PROCESO" de más de 10 min, por si se perdió un callback. Detalle en `13-pagos-en-bolivia.md`.

## 9. Validación en puerta (y por qué el QR usa Ed25519)

- Contenido del QR: `TKT1.<base64url(payload)>.<base64url(firma)>`, con payload `{"t":"<uuid entrada>","e":42,"i":1732237200}`. **Sin datos personales.**
- Firma **Ed25519** (asimétrica): solo el Worker tiene la **clave privada**. La API (y en el futuro la app del validador) solo necesitan la **pública**.
  - Ventaja frente a HMAC: un validador con la clave pública podría verificar la autenticidad **sin conexión**, algo útil en recintos con mala señal. Con HMAC, quien verifica también podría **firmar** (falsificar).
- La firma demuestra que **la entrada es auténtica**. La marca USADA (que no se use dos veces) exige consultar la BD **en línea**. El modo offline (lista local + sincronización posterior + resolución de conflictos) queda como mejora futura.
