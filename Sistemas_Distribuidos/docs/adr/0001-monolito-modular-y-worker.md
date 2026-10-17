# ADR-0001 — Monolito modular NestJS + Worker separado

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
3 personas, 6 semanas. El problema central es transaccional (reserva + orden + entradas). Necesitamos tolerancia a fallos en las tareas lentas (PDF y email) y escalado horizontal.

## Opciones consideradas
1. Monolito sin módulos.
2. Monolito modular + proceso Worker del mismo repo.
3. Microservicios (Catálogo, Inventario, Pagos, Entradas, Notificaciones).
4. Serverless.

## Decisión
**Opción 2.** Las transacciones ACID siguen siendo locales (sin sagas), y el Worker aísla los fallos de PDF y email. La API escala con N copias idénticas. Los módulos son dueños de sus tablas, lo que permite extraerlos después (Strangler Fig).
Microservicios: descartados porque añaden red, sagas y operación sin resolver el cuello real (Postgres). Serverless: no mantiene WebSockets y agota las conexiones a la BD.

## Consecuencias
- ➕ Una transacción para reservar o confirmar. Despliegue simple. Demostración clara de la caída del Worker.
- ➖ La API y el Worker comparten el esquema de BD: un cambio de esquema afecta a ambos (se mitiga con migraciones compatibles hacia atrás).
- 🔄 Revisar en la Fase 4 (nacional): extraer Validación y Notificaciones si sus picos o equipos lo justifican.
