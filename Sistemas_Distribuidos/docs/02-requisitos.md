# 02 — Requisitos

Notación: **RF** funcional · **RNF** no funcional · **RN** regla de negocio. Prioridad: **M** (must, imprescindible) · **S** (should, importante) · **C** (could, deseable).

## 1. Requisitos funcionales

### Autenticación y roles
| ID | Requisito | Prior. |
|---|---|---|
| RF-01 | Registrarse con email, contraseña (mín. 8 caracteres), nombre y teléfono opcional (+591). El rol por defecto es COMPRADOR. | M |
| RF-02 | Iniciar sesión y recibir un JWT con `sub`, `rol` y `exp`. | M |
| RF-03 | Un ADMIN puede asignar los roles ORGANIZADOR o VALIDADOR (los usuarios semilla se crean por script). | M |
| RF-04 | Los endpoints se protegen por rol (guard de NestJS). | M |

### Catálogo
| ID | Requisito | Prior. |
|---|---|---|
| RF-10 | Listar los eventos publicados, **filtrados por ciudad** (Cochabamba por defecto) y ordenados por fecha. | M |
| RF-11 | Ver el detalle del evento: recinto, ciudad, fecha en hora de Bolivia, zonas y precios en Bs. | M |
| RF-12 | Listar departamentos y ciudades con eventos activos. | S |

### Organizador
| ID | Requisito | Prior. |
|---|---|---|
| RF-20 | Crear y editar un recinto (nombre, dirección, ciudad). | M |
| RF-21 | Crear un evento en BORRADOR con título, recinto, fecha/hora local y fecha de apertura de venta. | M |
| RF-22 | Configurar zonas con su precio (centavos) y una grilla de filas × columnas, con asientos deshabilitables (pasillos). | M |
| RF-23 | Publicar el evento. Al publicar se generan las filas `asientos` y el mapa ya no se puede editar. | M |
| RF-24 | Ver el resumen de ventas: vendidos, reservados, libres y recaudación. | S |

### Compra
| ID | Requisito | Prior. |
|---|---|---|
| RF-30 | Ver el mapa con el estado de cada asiento (LIBRE / RESERVADO / VENDIDO / NO_DISPONIBLE). | M |
| RF-31 | Recibir **en vivo** los cambios de estado del mapa. | M |
| RF-32 | Reservar de 1 a 6 asientos de forma **atómica** (todos o ninguno). Se crea una orden PENDIENTE_PAGO que vence a los 5 min. | M |
| RF-33 | Ver un contador regresivo de la reserva. | M |
| RF-34 | Cancelar la reserva, que libera los asientos de inmediato. | S |
| RF-35 | Iniciar el pago con el proveedor configurado (Stripe test o simulador). | M |
| RF-36 | El pago se confirma **solo por webhook**, nunca porque el navegador "vuelva" de la página de pago. | M |
| RF-37 | Ingresar NIT y razón social opcionales para una futura factura. | C |
| RF-38 | Ver "Mis entradas" y descargar el PDF. | S |

### Entradas y notificaciones
| ID | Requisito | Prior. |
|---|---|---|
| RF-40 | Al confirmarse el pago se emite una entrada por asiento, con un QR firmado. | M |
| RF-41 | El Worker genera el PDF (en español, hora local) y lo envía por email de forma **asíncrona**. | M |
| RF-42 | Los envíos fallidos se reintentan con backoff. Tras N intentos el envío queda en "fallidos" y es visible. | M |

### Validación
| ID | Requisito | Prior. |
|---|---|---|
| RF-50 | El validador escanea el QR con la cámara del celular (web). | M |
| RF-51 | El sistema verifica la firma y marca la entrada USADA **una sola vez**. | M |
| RF-52 | Si ya estaba usada, muestra "YA USADA" con la hora local de uso. | M |
| RF-53 | El validador solo puede validar eventos asignados a él. | S |

## 2. Requisitos no funcionales (medibles)

| ID | Atributo | Requisito y métrica | Cómo se mide |
|---|---|---|---|
| RNF-01 | **Correctitud** | 0 sobreventas: con N peticiones concurrentes por el mismo asiento hay exactamente 1 éxito. | Test de integración en CI (N=50) + script de demo |
| RNF-02 | **Idempotencia** | Un webhook repetido K veces genera exactamente 1 orden PAGADA y 1 entrada por asiento. | Test de integración (K=5, en paralelo) |
| RNF-03 | **Latencia de reserva** | p95 < 300 ms en la API con carga de demo (50 req/s), medido en el servidor. | Métrica `http_request_duration` + script k6/autocannon |
| RNF-04 | **Tiempo real** | Cambio de asiento visible en otro cliente en p95 < 1 s. | Marca de tiempo en el evento WS vs. recepción |
| RNF-05 | **Tolerancia a fallos** | Con el Worker caído, el 100 % de las compras se completan. Al volver, todos los emails pendientes se envían en < 2 min. | Demo de caída |
| RNF-06 | **Reconexión** | Tras perder la red, el cliente reconecta solo (backoff hasta 10 s) y resincroniza el mapa. Si el WS falla 3 veces, pasa a polling cada 5 s. | Prueba manual con DevTools "Offline" + test e2e |
| RNF-07 | **Expiración** | Una reserva vencida no bloquea una nueva reserva **en ningún momento** (expiración perezosa). El job la limpia en ≤ 30 s. | Test con reloj controlado |
| RNF-08 | **Rendimiento móvil** | JS inicial de la página del mapa < 200 KB gzip. LCP < 2,5 s en 4G simulada. | Lighthouse (perfil "Slow 4G") |
| RNF-09 | **Seguridad** | Contraseñas con argon2id. JWT con expiración ≤ 60 min. Webhooks con firma verificada. QR firmado con Ed25519. | Revisión de código + tests |
| RNF-10 | **Rate limiting** | Reservas: máx. 10/min por usuario y 30/min por IP. Respuesta 429 con `Retry-After`. | Test de integración |
| RNF-11 | **Observabilidad** | Logs JSON con `requestId`. Métricas: reservas ok/conflicto, webhooks duplicados, tamaño de la cola, conexiones WS. | Endpoint `/metrics` + panel de demo |
| RNF-12 | **Disponibilidad (demo)** | La API responde en < 2 s tras inactividad (sin "cold start" de 1 min). | Máquinas siempre encendidas en Fly |
| RNF-13 | **Portabilidad** | Todo el sistema se levanta en local con Docker en < 5 min siguiendo el README. | Prueba de un integrante nuevo |
| RNF-14 | **Expansión** | Agregar un departamento o ciudad nueva no requiere cambios de código. | Script de semilla |

## 3. Reglas de negocio

| ID | Regla |
|---|---|
| RN-01 | Un asiento de un evento tiene **como máximo una entrada válida** (EMITIDA o USADA). |
| RN-02 | La reserva dura **5 minutos** desde su creación. Al iniciar el pago se extiende **una sola vez** 2 minutos, para pagos en curso. |
| RN-03 | Una orden reserva entre 1 y **6** asientos, todos del mismo evento. La reserva es **todo o nada**. |
| RN-04 | Un usuario puede tener **una sola** orden PENDIENTE_PAGO por evento. |
| RN-05 | Los montos son enteros en **centavos de BOB**. El total de la orden es la suma de los precios de las zonas **al momento de reservar** (precio congelado en `orden_items`). |
| RN-06 | Solo un webhook verificado puede pasar una orden a PAGADA. |
| RN-07 | Un pago que llega después de que se perdió el asiento (vencido y tomado por otro) deja la orden en **REEMBOLSO_REQUERIDO**, para gestión manual. Nunca se emite una entrada duplicada. |
| RN-08 | Una entrada pasa de EMITIDA a USADA **una sola vez**. No hay vuelta atrás desde el sistema. |
| RN-09 | No se venden asientos antes de `venta_inicio` ni después del inicio del evento. |
| RN-10 | Las fechas se muestran siempre en hora de Bolivia (`America/La_Paz`). |
| RN-11 | El QR no contiene nombre, email, CI ni teléfono, solo identificadores opacos y una firma. |

## 4. Fuera de alcance

| Elemento | Motivo | Mejora futura |
|---|---|---|
| Búsqueda compleja (texto libre, facetas) | No aporta al objetivo de concurrencia | Índice `pg_trgm` o un motor de búsqueda |
| OAuth | Complejidad sin valor didáctico aquí | Google Sign-In |
| Recuperación de contraseña | Requiere flujo de tokens por email, fuera del foco | Token de un solo uso con expiración |
| Facturación electrónica SIN | Integración regulatoria compleja (certificados, CUF, etc.) | Módulo de facturación que usa `nit`/`razon_social` |
| Cobro real en Bolivia | Requiere empresa con NIT y contrato con un banco o pasarela | Adaptador `QrBancario` (ver doc 13) |
| Reembolsos automáticos | Dependen del proveedor real | Job de reembolso con el adaptador |
| Validación offline en puerta | Conflictos de sincronización | Verificar la firma Ed25519 offline y sincronizar después (ver doc 05) |
