# Entradas: venta de entradas con asientos numerados

Proyecto de **Sistemas Distribuidos**. Sistema de venta de entradas para Bolivia (lanzamiento en Cochabamba) centrado en **alta concurrencia sin sobreventa**: nunca dos compras del mismo asiento.

La documentación de diseño está en [`docs/`](docs/) (empezar por [`docs/00-resumen.md`](docs/00-resumen.md)) y las decisiones en [`docs/adr/`](docs/adr/).

## Requisitos

| Herramienta | Versión | Comprobar |
|---|---|---|
| Node.js | 22 (ver `.nvmrc`) | `node -v` |
| npm | 10 o superior (viene con Node) | `npm -v` |
| Docker + Docker Compose v2 | Cualquiera reciente | `docker compose version` |

## Levantar todo desde cero

```bash
# 1. Clonar e instalar
git clone <url-del-repo> entradas
cd entradas
npm ci

# 2. Variables de entorno
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
```

Completar en `.env` los valores que vienen vacíos (la API y el Worker **no arrancan** sin ellos):

```bash
openssl rand -base64 32                 # → JWT_SECRET
openssl rand -base64 32                 # → SIMULADOR_WEBHOOK_SECRET
npm run claves:qr -w @entradas/worker   # → pegar las dos líneas QR_SIGNING_PRIVATE_KEY y QR_SIGNING_PUBLIC_KEY
# SEED_PASSWORD=<una contraseña de 8 o más caracteres para los usuarios semilla>
```

> Cada variable tiene que aparecer **una sola vez** en `.env`. Las semillas no cambian la contraseña de un usuario que ya existe: si cambias `SEED_PASSWORD` después de sembrar, empieza con la base vacía (ver *Problemas comunes*).

```bash
# 3. Infraestructura: Postgres 16, Redis 7 y Mailpit
docker compose up -d --wait

# 4. Esquema y datos iniciales
npm run build -w @entradas/shared -w @entradas/db
npm run db:deploy -w @entradas/db
npm run seed            # 9 departamentos, 7 ciudades, 2 recintos y 4 usuarios

# 5. API, Worker y web a la vez
npm run dev
```

`npm run dev` compila primero `packages/shared` y después levanta cuatro procesos con [concurrently](https://www.npmjs.com/package/concurrently). Cada línea del log lleva el nombre y el color de su proceso: `[shared]` amarillo, `[api]` azul, `[worker]` magenta y `[web]` verde. **Ctrl+C** los detiene a todos.

Para la demo conviene usar **una terminal por proceso** y así poder apagar solo el Worker:

```bash
npm run dev -w @entradas/api      # terminal 1
npm run dev -w @entradas/worker   # terminal 2
npm run dev -w @entradas/web      # terminal 3
```

### Usuarios semilla

Contraseña: el valor de `SEED_PASSWORD`. Un comprador nuevo se registra desde la web.

| Email | Rol | Para qué |
|---|---|---|
| `organizador@entradas.test` | ORGANIZADOR | Crear y publicar eventos (lo usa `demo:carrera`) |
| `validador@entradas.test` | VALIDADOR | Página `/validador` |
| `admin@entradas.test` | ADMIN | Todo lo anterior |
| `comprador@entradas.test` | COMPRADOR | Comprar |

### Comprobar que funciona

En otra terminal:

```bash
docker compose ps                      # postgres, redis y mailpit "healthy"
curl localhost:3000/health             # {"estado":"ok"}
curl -I localhost:3001                 # HTTP/1.1 200 OK
```

En el log, el Worker muestra `Worker iniciado: consumiendo el outbox`.

## Guion de la demo (3 escenas)

Preparación: todo levantado como en la sección anterior, con la API, el Worker y la web en terminales separadas. Abrir Mailpit (<http://localhost:8025>) y una consola SQL:

```bash
docker compose exec postgres psql -U entradas -d entradas
```

### Escena 1: 50 compradores, 1 asiento → exactamente 1 gana

```bash
npm run demo:carrera
# contra un despliegue:
npm run demo:carrera -- --base-url https://<app>.fly.dev --password '<SEED_PASSWORD>'
```

El script registra 50 compradores, crea y publica un evento de 1 fila × 10 con el organizador semilla y lanza 50 `POST /ordenes` **a la vez** por el asiento A1. Muestra una tabla con cada respuesta y una verificación final: **1 × 201, 49 × 409 `ASIENTOS_NO_DISPONIBLES`**, A1 `RESERVADO` en el mapa público y los otros 9 asientos `LIBRE`. Si el resultado no es exactamente 1 ganador, termina con código de salida 1.

Qué explicar: no hay locks distribuidos ni Redis decidiendo. Gana quien ejecuta primero `UPDATE asientos SET estado='RESERVADO' ... WHERE estado='LIBRE'`. Las otras 49 transacciones esperan el lock de la fila, re-evalúan el `WHERE` y no encuentran el asiento libre (doc 04, ADR-0002).

Opciones: `--n 100`, `--recinto-id <uuid>`, `--email-organizador`, `--password`.

### Escena 2: webhook duplicado ×5 → una sola entrada

1. En <http://localhost:3001>, registrarse como comprador, entrar al evento "Carrera …" de la escena 1 (o a cualquier otro), elegir un asiento libre y **Reservar**.
2. En la página de la orden (cuenta regresiva de 5 minutos), **Pagar** abre el simulador de pagos.
3. Elegir el modo **DUPLICAR** con 5 copias y **Confirmar**. Volver con el botón Atrás: la orden pasa a **PAGADA** sola (polling cada 3 s).
4. En el log de la API se ven 5 webhooks con el mismo `evento_externo_id`: uno `PAGADA` y cuatro `DUPLICADO`.
5. En SQL (reemplazar `<ordenId>`, que aparece en la página de la orden):

```sql
SELECT estado FROM ordenes WHERE id = '<ordenId>';                                   -- PAGADA
SELECT count(*) FROM entradas WHERE orden_id = '<ordenId>';                          -- 1 por asiento, no 5
SELECT count(*) FROM outbox WHERE payload->>'ordenId' = '<ordenId>';                 -- 1
```

Qué explicar: `UNIQUE(proveedor, evento_externo_id)` en `webhook_eventos`. El primer webhook inserta la fila y procesa el pago; los otros cuatro chocan con la restricción y responden 200 sin hacer nada (ADR-0004).

### Escena 3: Worker apagado → la API sigue vendiendo

1. **Ctrl+C en la terminal del Worker.**
2. Hacer 2 o 3 compras completas desde la web (modo **OK** en el simulador). Todas llegan a **PAGADA**: la venta no depende del Worker.
3. Mostrar el trabajo acumulado y que Mailpit no recibió nada nuevo:

```sql
SELECT id, tipo, creado_en, intentos FROM outbox WHERE publicado_en IS NULL;
```

4. Volver a arrancar el Worker (`npm run dev -w @entradas/worker`). En segundos procesa lo pendiente (`orden …: 1 entrada(s) enviadas`), la consulta anterior queda vacía y en Mailpit aparecen los emails con el PDF y el QR.

Qué explicar: el pago y la fila del outbox se escriben en **la misma transacción** (outbox transaccional, ADR-0005). El Worker la toma con `FOR UPDATE SKIP LOCKED` y un lease (ADR-0017). Si muere a la mitad, el lease vence y otro Worker la vuelve a tomar.

### Extra: validación en puerta

1. Ingresar en la web como `validador@entradas.test` → **Validar**. Elegir la ciudad y el evento.
2. Conseguir el texto del QR (`TKT1.…`): escanear el QR del PDF con la cámara del celular y copiar el texto, o imprimirlo desde la terminal:

```bash
docker compose exec -T postgres psql -tAF' ' -U entradas -d entradas -c \
  "SELECT e.id, o.evento_id, extract(epoch FROM e.emitida_en)::bigint
     FROM entradas e JOIN ordenes o ON o.id = e.orden_id
    WHERE o.id = '<ordenId>'"
npm run -s qr:entrada -w @entradas/worker -- <entradaId> <eventoId> <emitidaEnUnix>
```

3. Pegar el texto y **Validar** → **VALIDA**. Pegarlo otra vez → **YA_USADA**, con la hora del primer uso. Cambiar un carácter → **INVALIDA**. Elegir otro evento → **OTRO_EVENTO**.

Qué explicar: la firma Ed25519 se verifica con la clave **pública**: la API no puede fabricar entradas (ADR-0011). La marca de "usada" es un CAS `UPDATE entradas ... WHERE estado = 'EMITIDA'`: con 10 escaneos simultáneos, exactamente 1 da VALIDA (test A-06 en `apps/api/test/validaciones.e2e-spec.ts`).

## Servicios y puertos

| Servicio | URL / puerto | Qué es |
|---|---|---|
| Web (Next.js) | <http://localhost:3001> | Frontend |
| API (NestJS) | <http://localhost:3000> · `GET /health` | REST (el WebSocket quedó recortado: la web usa polling) |
| Worker (NestJS) | sin puerto | Lee el outbox de Postgres (QR, PDF, email) |
| PostgreSQL 16 | `localhost:5432` · usuario/clave/base `entradas` | Fuente de verdad |
| Redis 7 | `localhost:6379` | Reservado para Socket.IO y rate limit (BullMQ diferido, ADR-0017) |
| Mailpit | <http://localhost:8025> (SMTP en `1025`) | Ver los emails en local |

## Estructura

```
apps/
  api/        API NestJS (monolito modular)
  worker/     Worker NestJS sin HTTP
  web/        Frontend Next.js
packages/
  shared/     Tipos y constantes compartidos
  db/         Esquema Prisma, migraciones y semillas
scripts/
  carrera.mjs Demo de la carrera (npm run demo:carrera)
docs/         Documentación y ADR
docker-compose.yml   Infraestructura local
.env.example         Variables de api, worker y docker compose
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta shared (en modo watch), api, worker y web |
| `npm run build` | Compila shared y después api, worker y web |
| `npm run typecheck` | Revisa los tipos de los cuatro paquetes |
| `npm run seed` | Carga departamentos, ciudades de Cochabamba, 2 recintos de demo y un usuario por rol (`*@entradas.test`, contraseña = `SEED_PASSWORD`). Se puede repetir sin duplicar |
| `npm run demo:carrera` | Escena 1 de la demo: 50 compradores por el mismo asiento |
| `npm run lint` · `npm test` · `npm run test:e2e` | Lint, tests unitarios y e2e (los e2e necesitan `docker compose up`) |
| `docker compose up -d --wait` | Levanta la infraestructura y espera a que esté sana |
| `docker compose down` | Detiene la infraestructura (conserva los datos) |
| `docker compose down -v` | Detiene y **borra** los datos de Postgres y Redis |

## Problemas comunes

- **`port is already allocated`**: otro programa usa 5432, 6379, 3000 o 3001 (por ejemplo, un Postgres instalado en el sistema). Hay que detenerlo o cambiar el puerto.
- **La API no ve un cambio en `packages/shared`**: con `npm run dev`, shared se recompila solo. Si se corre una app por separado, primero `npm run build -w @entradas/shared`.
- **Empezar con la base vacía**: `docker compose down -v && docker compose up -d --wait`.
- **La API no arranca: `Falta JWT_SECRET` / `Falta QR_SIGNING_PUBLIC_KEY`**: completar el `.env` (paso 2). La API solo necesita la clave pública del QR; el Worker, la privada.
- **`demo:carrera` falla con 401 en el login**: la contraseña del organizador semilla no es la de `SEED_PASSWORD` (se sembró antes con otra). Pasar `--password '<la correcta>'` o empezar con la base vacía y volver a sembrar.
