# ADR-0012 — Despliegue: Vercel + Fly.io gru + Supabase sa-east-1 + Redis en Fly + Resend

- **Estado:** Aceptado · **Fecha:** 2026-10-16

## Contexto
Usuarios en Bolivia. Presupuesto de hasta ~US$5–10/mes. API, Worker y Redis siempre encendidos durante la demo. Datos verificados el 16/10/2026 (ver doc 07).

## Opciones consideradas
1. Fly.io `gru` (API, Worker, Redis) + Supabase `sa-east-1` + Vercel + Resend.
2. Railway Hobby (US East) + Supabase + Vercel + Resend.
3. Render free + Upstash free + Worker local.

## Decisión
**Opción 1** (plan B: opción 2; plan C: todo local con Docker).
- Fly es la única plataforma evaluada con cómputo en Sudamérica (São Paulo), en la misma ciudad que Supabase `sa-east-1`.
- Redis en Fly dentro de la red privada: BullMQ consulta Redis aunque esté en reposo, lo que agota los 500K comandos/mes del plan gratis de Upstash.
- Render free se duerme a los 15 min (arranque de ~1 min), no tiene workers gratis y no tiene región en Sudamérica.
- Resend: 3.000/mes y 100/día con dominio propio. SendGrid retiró su plan gratis.
- Vercel Hobby es solo no comercial: válido para el proyecto universitario. Producción necesita Pro.

## Consecuencias
- ➕ Baja latencia API↔BD y hacia Bolivia. Multi-instancia real.
- ➖ Fly requiere tarjeta y no tiene free tier para cuentas nuevas. Supabase Free se pausa tras 1 semana inactivo.
- 🔄 Revisar si cambian los free tiers (verificar en la semana 1).
