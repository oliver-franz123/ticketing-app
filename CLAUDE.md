# CLAUDE.md — Contexto del proyecto

Proyecto universitario de **Sistemas Distribuidos** (6 semanas, equipo de 3).
Sistema distribuido de **venta de entradas con asientos numerados**, centrado en **alta concurrencia sin sobreventa** (nunca dos compras del mismo asiento).

La documentación completa vive en `docs/`. Las decisiones están en `docs/adr/`. Si algo de este archivo contradice un ADR, **manda el ADR más reciente**.

## Reglas de trabajo para Claude

- **Fase actual: planificación.** No escribir código de la aplicación ni inicializar proyectos (nada de `npm init`, `nest new`, `docker-compose`, etc.) salvo que el equipo lo pida explícitamente.
- Documentación en **Markdown** y diagramas en **Mermaid** (componentes, despliegue, secuencia, estados, ER, flujo).
- Explicar para estudiantes con el formato **problema → opciones → elección → por qué**, con ejemplos concretos.
- Cada tecnología necesita una **razón técnica concreta**. Si algo no aporta valor real, decirlo.
- Si algo es ambiguo, **preguntar antes de generar**.
- Verificar con búsqueda web los datos que cambian (free tiers, regiones, pasarelas de pago). No darlos por supuestos.
- Idioma: **español de Bolivia** (documentación, interfaz, emails, PDF).
- Nunca usar `findUnique` sobre claves de índices únicos parciales (ver ADR-0016); usar `findFirst` con el filtro de estado.

## Contexto de país: Bolivia

- Lanzamiento en **Cochabamba**, después los demás departamentos (La Paz, Santa Cruz, Oruro, Potosí, Chuquisaca, Tarija, Beni, Pando) y finalmente todo el país. Los eventos y recintos tienen **ciudad → departamento**, y hay filtro por ciudad.
- Moneda **BOB**. Montos como **enteros en centavos** (`bigint`), nunca `float`.
- Fechas en **UTC** (`timestamptz`), mostradas en `America/La_Paz` (UTC-4, sin horario de verano).
- Teléfono con prefijo **+591**.
- **Pagos:** Stripe no acepta comercios con cuenta boliviana (verificado en stripe.com/global: en Latinoamérica solo figuran Brasil y México). El **proveedor principal es un simulador propio** (ADR-0015). Los pagos van detrás de un puerto/adaptador con tres proveedores: `Simulador` (**principal**: webhook firmado, inyecta fallos, retrasos y duplicados), `StripeTest` (**opcional**, solo si se puede abrir la cuenta de test) y `QrBancario` (**futuro**: QR interoperable/QR Simple, pasarela local, billeteras).
- **Redes móviles** con latencia variable: WebSocket con reconexión automática y respaldo por polling. Frontend liviano.
- **Facturación SIN:** fuera de alcance. Campos opcionales `nit` y `razon_social` en la orden.
- **Datos personales:** contraseñas con hash (argon2id), mínimo de datos y QR **sin datos personales**.

## Alcance

**Roles:** Comprador, Organizador/Admin y Validador.
**Funcionalidad:** listado de eventos por ciudad, mapa de asientos en tiempo real, reserva de 5 minutos, pago confirmado por webhook, QR firmado + PDF, email asíncrono y validación en puerta.
**Excluido:** búsqueda compleja, OAuth y recuperación de contraseña.

## Decisiones tomadas (resumen; detalle en `docs/adr/`)

1. **Monolito modular NestJS + proceso Worker** (mismo repo). Nada de microservicios.
2. **PostgreSQL es la fuente de verdad** de la concurrencia: `UPDATE ... WHERE estado='LIBRE'` atómico, restricciones únicas y `expires_at`. Redis **no** decide quién gana un asiento. Sin bloqueo pesimista de larga duración ni locks distribuidos.
3. **Expiración:** `expires_at` + expiración perezosa en la propia consulta + job de limpieza que libera y notifica.
4. **Webhook idempotente:** tabla de eventos procesados con `UNIQUE(proveedor, evento_externo_id)`.
5. **Outbox transaccional** para encolar PDF/QR/email sin el problema de la doble escritura.
6. **Comunicación híbrida:** REST + WebSocket (Socket.IO, solo estado de asientos) + cola BullMQ. GraphQL descartado.
7. **Auth propia con JWT** en NestJS (email + contraseña, rol en el token).
8. **QR firmado con Ed25519.** El payload solo lleva IDs opacos.
9. **Stack:** Next.js + React + TS (Vercel) · NestJS en **Fly.io región `gru` (São Paulo)** · Postgres en **Supabase `sa-east-1`**, usado solo como Postgres administrado · Redis + BullMQ (Redis en Fly `gru`) · **Resend** con dominio propio · Docker en local · GitHub Actions para CI · Prisma como ORM (SQL explícito en las consultas críticas).
10. **Presupuesto:** hasta ~US$5–10 al mes durante la demo.

## Metodología

Scrum adaptado con **sprints semanales**. **TDD** en concurrencia e idempotencia. Slices verticales entre 3 personas (Integrante A/B/C; reemplazar por nombres reales en `docs/11-plan-6-semanas.md`).

## Demo obligatoria

- 50 peticiones simultáneas por el mismo asiento: **exactamente 1** gana y 49 reciben 409.
- Se apaga el Worker: la API sigue vendiendo. Al volver, procesa los jobs pendientes.
- Webhook duplicado: una sola entrada.
- Logs y métricas visibles.

## Mapa de documentos

`docs/00` resumen docente · `01` visión · `02` requisitos · `03` arquitectura · `04` concurrencia · `05` comunicación e idempotencia · `06` carga · `07` despliegue · `08` patrones · `09` modelo de datos · `10` pruebas y demo · `11` plan · `12` glosario · `13` pagos en Bolivia · `adr/`
