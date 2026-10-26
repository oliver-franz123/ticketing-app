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

# 2. Variables de entorno (los valores por defecto sirven para local)
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Infraestructura: Postgres 16, Redis 7 y Mailpit
docker compose up -d --wait

# 4. API, Worker y web a la vez
npm run dev
```

`npm run dev` compila primero `packages/shared` y después levanta cuatro procesos con [concurrently](https://www.npmjs.com/package/concurrently). Cada línea del log lleva el nombre y el color de su proceso: `[shared]` amarillo, `[api]` azul, `[worker]` magenta y `[web]` verde. **Ctrl+C** los detiene a todos.

### Comprobar que funciona

En otra terminal:

```bash
docker compose ps                      # postgres, redis y mailpit "healthy"
curl localhost:3000/health             # {"estado":"ok"}
curl -I localhost:3001                 # HTTP/1.1 200 OK
```

En el log, el Worker muestra `Worker iniciado (todavía sin colas)`.

## Servicios y puertos

| Servicio | URL / puerto | Qué es |
|---|---|---|
| Web (Next.js) | <http://localhost:3001> | Frontend |
| API (NestJS) | <http://localhost:3000> · `GET /health` | REST + WebSocket |
| Worker (NestJS) | sin puerto | Procesa la cola (QR, PDF, email) |
| PostgreSQL 16 | `localhost:5432` · usuario/clave/base `entradas` | Fuente de verdad |
| Redis 7 | `localhost:6379` | Cola, pub/sub y rate limit |
| Mailpit | <http://localhost:8025> (SMTP en `1025`) | Ver los emails en local |

## Estructura

```
apps/
  api/        API NestJS (monolito modular)
  worker/     Worker NestJS sin HTTP
  web/        Frontend Next.js
packages/
  shared/     Tipos y constantes compartidos
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
| `npm run seed` | Carga departamentos, ciudades de Cochabamba y un usuario por rol (`*@entradas.test`, contraseña = `SEED_PASSWORD`). Se puede repetir sin duplicar |
| `docker compose up -d --wait` | Levanta la infraestructura y espera a que esté sana |
| `docker compose down` | Detiene la infraestructura (conserva los datos) |
| `docker compose down -v` | Detiene y **borra** los datos de Postgres y Redis |

## Problemas comunes

- **`port is already allocated`**: otro programa usa 5432, 6379, 3000 o 3001 (por ejemplo, un Postgres instalado en el sistema). Hay que detenerlo o cambiar el puerto.
- **La API no ve un cambio en `packages/shared`**: con `npm run dev`, shared se recompila solo. Si se corre una app por separado, primero `npm run build -w @entradas/shared`.
- **Empezar con la base vacía**: `docker compose down -v && docker compose up -d --wait`.
