# 08 — Patrones de diseño y conceptos de system design

Cada fila responde: **¿qué es?**, **¿dónde aparece en nuestro sistema?** y **¿qué problema resuelve aquí?**

## 1. Patrones de diseño (código)

| Patrón | Qué es | Dónde aparece | Problema que resuelve |
|---|---|---|---|
| **Adapter** | Envuelve una API externa detrás de una interfaz propia | `StripeTestAdapter`, `SimuladorAdapter`, `QrBancarioAdapter` implementan `ProveedorPago` | El dominio no depende de Stripe, y cambiar a un QR bancario no toca Órdenes |
| **Strategy** | Elegir el algoritmo en tiempo de ejecución | `PAYMENT_PROVIDER=stripe\|simulador` elige el adaptador al arrancar | Mismo flujo con distintos proveedores, en tests y en la demo |
| **Puertos y adaptadores (hexagonal, ligero)** | El núcleo define interfaces y la infraestructura las implementa | `ProveedorPago`, `EnviadorEmail` (Resend o Mailpit), `FirmadorQr` | Probar la lógica con dobles de prueba sin red |
| **Repository** | Acceso a datos detrás de métodos con nombre del dominio | `AsientosRepository.reservarAtomico(tx, eventoId, ids, ordenId)` | Encapsula el SQL crítico en un solo lugar probado |
| **Unit of Work / Transacción explícita** | Un conjunto de cambios que se confirma o se descarta junto | `prisma.$transaction(async (tx) => ...)` en reservar y en el webhook | Atomicidad entre asientos, orden, entradas y outbox |
| **State machine** | Transiciones permitidas explícitas | Estados de asiento, orden y entrada (doc 04), validados con `WHERE estado = <origen>` | Impide transiciones ilegales (p. ej. PAGADA → EXPIRADA) |
| **Observer / Pub-Sub** | Los publicadores no conocen a los suscriptores | Delta del mapa → Redis pub/sub → todas las instancias → sockets de la sala | Desacopla "algo cambió" de "a quién avisar" |
| **Guard / Interceptor (NestJS)** | Lógica transversal antes o después del handler | `JwtGuard`, `RolesGuard`, `ThrottlerGuard`, interceptor de `Idempotency-Key` y de `requestId` | Seguridad y observabilidad sin repetir código |
| **Dependency Injection** | Las dependencias se inyectan, no se construyen dentro | Módulos de NestJS | Tests: inyectar `SimuladorAdapter` o un reloj falso |
| **Template Method / Pipeline** | Pasos fijos con partes variables | Procesadores de jobs: cargar → procesar → marcar → encadenar el siguiente job | Uniformidad en el manejo de errores y reintentos |

## 2. Patrones de sistemas distribuidos

| Patrón / concepto | Qué es | Dónde aparece | Problema que resuelve |
|---|---|---|---|
| **Fuente única de verdad** | Un solo sistema decide el estado autoritativo | Postgres para asientos, órdenes y entradas | Evita discrepancias entre Redis, la caché y la BD |
| **Compare-and-set / UPDATE condicional** | Escribir solo si el estado es el esperado, en una operación | `UPDATE ... WHERE estado='LIBRE'` (doc 04) | Condición de carrera *check-then-act* |
| **Lease / Lock lógico con TTL** | Propiedad temporal que vence sola | `estado=RESERVADO` + `expires_at` | Reserva de 5 min sin locks de BD largos y sin depender de que el cliente "devuelva" el asiento |
| **Expiración perezosa** | Tratar como vencido al leer, sin esperar a la limpieza | `OR (estado='RESERVADO' AND expires_at < now())` | La correctitud no depende del job |
| **Idempotent Receiver** | El consumidor ignora mensajes ya procesados | `webhook_eventos UNIQUE`, `Idempotency-Key`, `jobId` de BullMQ | Entrega al-menos-una-vez sin efectos dobles |
| **Transactional Outbox** | Guardar el evento en la misma transacción que el cambio y publicarlo después | Tabla `outbox` + relay | Doble escritura BD + cola |
| **Competing Consumers** | Varios workers consumen la misma cola | N Workers con BullMQ | Escalar el procesamiento de PDF y email |
| **Retry con backoff exponencial + jitter** | Reintentar espaciando y con aleatoriedad | Jobs de BullMQ, reconexión de Socket.IO, cliente HTTP | Fallos transitorios sin estampida |
| **Dead Letter Queue** | Donde terminan los mensajes que fallan siempre | Estado *failed* de BullMQ + `envios_email.FALLIDO` | Que un mensaje "venenoso" no se reintente para siempre y quede visible |
| **Bulkhead (compartimentos)** | Aislar recursos para que un fallo no hunda todo | Proceso Worker separado de la API. Colas separadas para PDF y email | Un Resend lento no frena las reservas |
| **Degradación elegante** | Seguir funcionando con menos calidad | WS → polling. Rate limit en Redis → memoria local | Fallos parciales sin caída total |
| **Rate limiting (token bucket / ventana deslizante)** | Limitar peticiones por clave | `@nestjs/throttler` + Redis | Bots, reintentos agresivos y fuerza bruta en el login |
| **Control de admisión / sala de espera** | Admitir carga a ritmo sostenible | Diseño en doc 06 §5 | La manada del minuto cero |
| **Escalado horizontal sin estado** | Copias idénticas detrás de un balanceador | Máquinas `api` en Fly | Más capacidad sin rediseñar |
| **Backplane pub/sub para WS** | Bus compartido entre instancias con conexiones persistentes | `@socket.io/redis-adapter` | Clientes en instancias distintas |
| **Coalescing / batching** | Agrupar muchos eventos pequeños en uno | Deltas del mapa cada 250 ms | El fan-out del WS |
| **Microcaching** | Caché de 1 s para lecturas idénticas masivas | Snapshot del mapa por instancia | Miles de lecturas iguales por segundo |
| **Versionado / números de secuencia** | Cada cambio lleva una versión creciente | `asientos.version`, `eventos.mapa_version` | Detectar mensajes perdidos o desordenados y resincronizar |
| **Consistencia eventual (en el cliente)** | Las réplicas convergen con el tiempo | El mapa del navegador es una réplica que converge | Aceptable: la BD decide en el momento de reservar |
| **Consistencia fuerte (en la BD)** | Lecturas y escrituras linealizables sobre una fila | Reserva y validación en el primario de Postgres | Sin sobreventa |
| **CQRS (idea, no framework)** | Separar el modelo de escritura del de lectura | Escritura: tablas normalizadas. Lectura: snapshot compacto + deltas | Optimizar la lectura masiva sin complicar la escritura |
| **Reconciliación** | Comparar periódicamente con la fuente externa | Job futuro que consulta `consultarEstado` en pagos EN_PROCESO > 10 min | Webhooks perdidos (sobre todo con el QR bancario) |
| **Saga / compensación (no usado, explicado)** | Transacciones distribuidas con pasos compensatorios | Lo necesitaríamos con microservicios (doc 03 §5) | Justifica por qué un monolito simplifica |
| **Strangler Fig** | Extraer partes de un monolito gradualmente | Plan de la Fase 4: extraer Validación y Notificaciones | Evolución sin reescritura total |
| **Defensa en profundidad** | Varias capas de protección | UPDATE condicional + UNIQUE parcial + CHECK + idempotencia | Un bug en una capa no rompe la invariante |
| **Firma digital / tokens autocontenidos** | Verificar autenticidad sin consultar al emisor | JWT (HMAC) para sesiones. QR con Ed25519 | Sesiones sin estado en el servidor y QR infalsificable |

## 3. Teorema CAP aplicado (explicación breve)

Ante una **partición de red** (P), hay que elegir entre **Consistencia** (C) y **Disponibilidad** (A).

| Parte del sistema | Elección | Ejemplo |
|---|---|---|
| Reserva y venta | **C**: si la API no llega a Postgres, responde 503. **No** "reserva a ciegas" | Sin BD no se vende nada. Mejor no vender que vender dos veces |
| Mapa en vivo | **A**: si Redis o WS fallan, se muestra el último estado conocido + polling | Un mapa algo desactualizado es aceptable |
| Email | **A** con consistencia eventual: llega más tarde | El comprador ve la entrada en la web |
| Validación en puerta | **C** (versión actual): sin conexión no se marca USADA. Futuro: modo offline con riesgo controlado | Trade-off que decide el organizador |

## 4. Mapa: concepto → documento

| Concepto | Doc |
|---|---|
| Concurrencia, locks, estados, expiración | 04 |
| Idempotencia, outbox, reintentos, adapter de pagos | 05 |
| Escalado, fan-out, rate limiting, CAP en carga | 06 |
| Despliegue, regiones, CI/CD | 07 |
| Restricciones e índices | 09 |
| Cómo se prueba cada patrón | 10 |
