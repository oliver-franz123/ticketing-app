# 12 — Glosario y errores comunes

## 1. Glosario

| Término | Definición breve | Ejemplo en nuestro sistema |
|---|---|---|
| **ACID** | Atomicidad, Consistencia, Aislamiento y Durabilidad de una transacción | Reservar 3 asientos + crear la orden: o todo o nada |
| **Adapter (patrón)** | Clase que traduce una interfaz externa a una propia | `SimuladorAdapter` implementa `ProveedorPago`. `StripeTestAdapter` (opcional) sería otro adaptador del mismo puerto |
| **ADR** | *Architecture Decision Record*: registro corto de una decisión y su porqué | `docs/adr/0002-...md` |
| **Al-menos-una-vez** | Garantía de entrega: el mensaje llega 1 o más veces | Webhooks y jobs de BullMQ |
| **Argon2id** | Algoritmo de hash de contraseñas, lento a propósito y resistente a GPU | `usuarios.password_hash` |
| **Backoff exponencial** | Esperar cada vez más entre reintentos (1 s, 2 s, 4 s...) | Reintentos de email |
| **Backplane** | Canal compartido entre instancias para retransmitir mensajes | Redis pub/sub para Socket.IO |
| **BullMQ** | Librería de colas de trabajo sobre Redis para Node.js | Colas `emitir-pdf`, `enviar-email` |
| **CAP** | Ante una partición de red, elegir consistencia o disponibilidad | Reservar: C. Mapa: A |
| **CAS (compare-and-set)** | Escribir solo si el valor actual es el esperado, en un paso | `UPDATE ... WHERE estado='LIBRE'` |
| **Centavos** | Unidad mínima, para guardar dinero como entero | Bs 25,50 = `2550` |
| **CGNAT** | Muchos clientes del operador móvil comparten una IP pública | Por eso el rate limit principal es por usuario |
| **Coalescing** | Juntar muchos eventos en uno solo cada X ms | Deltas del mapa cada 250 ms |
| **Cola de fallidos (DLQ)** | Lugar para mensajes que agotaron sus reintentos | Jobs *failed* en Bull Board |
| **Condición de carrera** | El resultado depende del orden temporal de operaciones concurrentes | Dos `SELECT` LIBRE seguidos de dos `UPDATE` |
| **Consistencia eventual** | Las copias convergen al mismo valor con el tiempo | El mapa en el navegador |
| **Deadlock** | Dos transacciones esperan cada una un lock que tiene la otra | Evitado con `ORDER BY id FOR UPDATE` |
| **Delta** | Solo los cambios desde una versión | `{desde:812, hasta:815, cambios:[...]}` |
| **Ed25519** | Algoritmo de firma digital asimétrica, rápido y con claves cortas | Firma del QR |
| **E.164** | Formato internacional de teléfono | `+59171234567` |
| **Expiración perezosa** | Considerar vencido algo al consultarlo, sin esperar a un proceso de limpieza | `expires_at < now()` en el WHERE de la reserva |
| **Fan-out** | Un mensaje que se reenvía a muchos destinatarios | 1 cambio → 20.000 sockets |
| **Fencing token** | Número creciente que protege contra dueños de locks vencidos | Por qué Redlock no basta sin la BD |
| **Fuente de verdad** | El sistema cuyo dato es el oficial | Postgres |
| **Idempotencia** | Repetir una operación tiene el mismo efecto que hacerla una vez | Webhook duplicado → 1 entrada |
| **Idempotency-Key** | Clave enviada por el cliente para deduplicar reintentos | UUID en `POST /ordenes` |
| **Jitter** | Aleatoriedad añadida a los tiempos de espera | Reconexión de 1 s ± 30 % |
| **JWT** | Token firmado que lleva datos (`sub`, `rol`, `exp`) | `Authorization: Bearer ...` |
| **Lease** | Propiedad temporal que vence sola | Reserva de 5 minutos |
| **Monolito modular** | Una sola aplicación desplegable, dividida en módulos con fronteras | API NestJS |
| **Outbox** | Tabla donde se guarda, en la misma transacción, un evento que se publicará después | `outbox` → BullMQ |
| **p95** | El 95 % de las peticiones tarda menos que este valor | p95 de la reserva < 300 ms |
| **Pooler** | Intermediario que reutiliza conexiones a la BD | Supavisor de Supabase |
| **Pub/Sub** | Publicadores y suscriptores desacoplados por canales | Redis: canal por sala de evento |
| **Rate limiting** | Limitar cuántas peticiones acepta el sistema por clave y tiempo | 10 reservas/min por usuario |
| **READ COMMITTED** | Nivel de aislamiento por defecto de Postgres: cada sentencia ve lo ya confirmado | Re-evaluación del WHERE en UPDATE concurrentes |
| **Reconciliación** | Comparar periódicamente con el sistema externo para corregir diferencias | Consultar al banco los pagos sin callback |
| **Región** | Ubicación física de los servidores de un proveedor | `gru` / `sa-east-1` = São Paulo |
| **Saga** | Secuencia de transacciones locales con compensaciones | Lo que haría falta con microservicios |
| **SKIP LOCKED** | Opción de Postgres para saltar filas bloqueadas por otro en vez de esperar | Relay del outbox, job de expiración y reserva |
| **Slice vertical** | Funcionalidad completa de punta a punta (BD → API → UI) | "Reservar asiento" de una persona |
| **Snapshot** | Estado completo en un instante | Mapa entero con `version` |
| **Sticky session** | El balanceador envía siempre al mismo cliente a la misma instancia | Lo evitamos usando solo transporte websocket + polling REST |
| **Strangler Fig** | Extraer partes de un sistema viejo de forma gradual | Plan para extraer Validación |
| **Thundering herd (manada)** | Muchos clientes que actúan en el mismo instante | Apertura de la venta. Reconexión masiva |
| **TTL** | *Time to live*: tiempo de vida antes de vencer | 5 min de reserva |
| **Webhook** | Petición HTTP que un servicio externo envía para avisar de un evento | El simulador de pagos avisa "pago exitoso" con `POST /webhooks/pagos/simulador`. Stripe (opcional) haría lo mismo en `/webhooks/pagos/stripe` |
| **WebSocket** | Conexión bidireccional persistente sobre TCP | Mapa en vivo |

## 2. Errores comunes (y cómo los evitamos)

### Concurrencia
| ❌ Error | Por qué está mal | ✅ Lo correcto |
|---|---|---|
| `SELECT` estado y, si está LIBRE, `UPDATE` en dos pasos | Condición de carrera *check-then-act* | Un único `UPDATE ... WHERE estado='LIBRE'` y revisar las filas afectadas |
| "Ya lo controlo en el frontend deshabilitando el botón" | Dos usuarios distintos o un script se lo saltan | La BD decide. El frontend solo mejora la experiencia |
| Usar Redis `SETNX` como verdad del asiento | Dos fuentes de verdad. TTL inseguro ante pausas | Redis solo para cola, pub/sub y rate limit |
| `SELECT ... FOR UPDATE` y esperar a que el usuario pague | Conexiones agotadas. Usuarios bloqueados | Estado RESERVADO + `expires_at` |
| Reservar los asientos de uno en uno en un bucle | Reservas parciales. Deadlocks | Una sentencia con `ANY($ids)` + `ORDER BY id` + todo o nada |
| Comparar el vencimiento con `new Date()` de Node | Relojes distintos entre instancias | `now()` de Postgres |
| Depender del job para liberar asientos | Si el Worker cae, los asientos quedan bloqueados | Expiración perezosa en la consulta |
| Probar la concurrencia con mocks | Los mocks no tienen locks | Postgres real en Docker o CI |
| Tests de concurrencia con **una** sola conexión compartida | Las sentencias se serializan en la conexión y nunca hay carrera real | Un pool con N conexiones o N clientes |

### Pagos e idempotencia
| ❌ Error | Por qué está mal | ✅ Lo correcto |
|---|---|---|
| Marcar PAGADA cuando el usuario vuelve a `/success` | La URL se puede visitar sin pagar | Solo el webhook verificado confirma |
| Parsear el JSON antes de verificar la firma | La firma es sobre los bytes exactos | `rawBody` en la ruta del webhook |
| Responder 500 al webhook duplicado | El proveedor reintenta para siempre | 200 si ya se procesó |
| Comprobar "¿ya procesado?" con un SELECT y luego INSERT | Carrera entre dos webhooks simultáneos | `INSERT ... ON CONFLICT DO NOTHING` dentro de la transacción |
| Encolar el email **antes** del COMMIT | El email sale aunque la transacción falle | Outbox |
| Encolar **después** del COMMIT sin outbox | Si la API cae entre los dos pasos, el email nunca sale | Outbox |
| Guardar montos como `float` / `numeric` en JS | Errores de redondeo (`0.1+0.2`) | Enteros en centavos (`bigint`) |
| Reintentar errores permanentes (422) | Gasta la cuota (100 emails/día) | Clasificar transitorio vs. permanente |
| Dejar la clave `sk_live_` en un `.env` | Cobros reales accidentales | La API se niega a arrancar con `live` |

### Tiempo real
| ❌ Error | Por qué está mal | ✅ Lo correcto |
|---|---|---|
| Reservar por WebSocket | Sin código de respuesta claro ni idempotencia, y se pierde si se cae el socket | REST para acciones y WS solo para informar |
| PUBLISH antes del COMMIT | Se anuncian estados que quizá nunca existan | Primero COMMIT, después PUBLISH |
| No resincronizar tras reconectar | Se pierden los cambios ocurridos durante el corte | Pedir el delta desde `versionLocal` |
| Enviar cada cambio a cada cliente en tiempo real | Fan-out de cientos de miles de mensajes/s | Coalescing + salas por zona |
| Reconexión sin jitter | Miles reconectan en el mismo ms | Backoff + jitter |
| Socket.IO long-polling con varias instancias sin sticky sessions | El handshake se reparte entre instancias y falla | `transports:['websocket']` + polling REST propio |

### Fechas, dinero y localización
| ❌ Error | ✅ Lo correcto |
|---|---|
| Guardar "21:00" sin zona horaria | `timestamptz` en UTC y mostrar en `America/La_Paz` |
| Usar la zona horaria del servidor (Fly/Vercel corren en UTC) | Zona explícita en `Intl.DateTimeFormat('es-BO', {timeZone:'America/La_Paz'})` |
| Mostrar `$300` o `300.00` | `Bs 300,00` con `Intl.NumberFormat('es-BO', {style:'currency', currency:'BOB'})` (verificar en el navegador que el símbolo salga como "Bs") |
| `ciudad` como texto libre | Tabla `ciudades` con FK |

### Seguridad y datos
| ❌ Error | ✅ Lo correcto |
|---|---|
| Poner el email o nombre en el QR | Solo el UUID de la entrada + la firma |
| Firmar el QR con HMAC y dar la clave a los validadores | Ed25519: los validadores solo tienen la pública |
| Loguear el body del webhook o los JWT | Loguear IDs y el hash del payload |
| IDs secuenciales en URLs públicas (`/entradas/1234`) | UUID |
| Exponer Redis a Internet | Red privada de Fly (`.internal`) |

### Proceso y proyecto
| ❌ Error | ✅ Lo correcto |
|---|---|
| Dejar el despliegue para la semana 5 | Desplegar en la semana 1 (`/health`) y ejecutar la carrera contra producción en la semana 2 |
| Repartir por capas ("yo el backend, tú el frontend") | Slices verticales: cada uno entrega funcionalidades completas |
| Agregar Kafka / microservicios / K8s "porque es distribuido" | Cada tecnología necesita un problema que resuelva (doc 03) |
| No ensayar la demo | 3 ensayos + plan C local |
| Olvidar que Supabase Free se pausa tras 1 semana inactivo | Revisarlo el día anterior |
