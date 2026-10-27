import { Inject, Injectable, Logger } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import { CorreoService } from '../email/correo.service';
import { generarPdf } from '../pdf/pdf';
import { PrismaService } from '../prisma/prisma.service';
import { CLAVE_QR } from '../qr/clave-qr';
import { firmarQr } from '../qr/qr';

// CHECK envios_email_estado_chk (migración outbox_y_emails).
type EstadoEnvio = 'PENDIENTE' | 'ENVIADO' | 'FALLIDO';

interface FilaEntrada {
  email: string;
  nombre: string;
  titulo: string;
  inicio: Date;
  recinto: string;
  ciudad: string;
  entrada_id: string;
  evento_id: string;
  emitida_en: Date;
  zona: string;
  fila: string;
  columna: number;
}

// ENTRADAS_EMITIDAS: un QR firmado por entrada, UN PDF con todas y UN email
// con el PDF adjunto por orden.
// Idempotencia (doc 05 §5): envios_email con PK (orden_id, tipo). Si ya está
// ENVIADO no se genera nada. Duplicados aceptados (ADR-0017): el Worker muere
// entre el envío SMTP y el UPDATE a ENVIADO, o hay dos filas de la misma orden
// procesadas a la vez (hoy la API inserta una sola por orden).
@Injectable()
export class EmitirEntradas {
  private readonly log = new Logger(EmitirEntradas.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly correo: CorreoService,
    @Inject(CLAVE_QR) private readonly clave: KeyObject,
  ) {}

  async ejecutar(ordenId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO envios_email (orden_id, tipo) VALUES (${ordenId}::uuid, 'ENTRADAS')
      ON CONFLICT (orden_id, tipo) DO NOTHING`;
    const [envio] = await this.prisma.$queryRaw<{ estado: EstadoEnvio }[]>`
      SELECT estado FROM envios_email WHERE orden_id = ${ordenId}::uuid AND tipo = 'ENTRADAS'`;
    switch (envio.estado) {
      case 'PENDIENTE':
        break;
      case 'ENVIADO':
        // Ya salió: la fila del outbox se marca procesada sin generar nada.
        this.log.log(`orden ${ordenId}: email de entradas ya ENVIADO, nada que hacer`);
        return;
      case 'FALLIDO':
        // Error permanente (doc 05 §7): no se reintenta. La fila del outbox se
        // marca procesada para no reintentar cada 120 s; queda visible en
        // envios_email para el organizador. Este slice todavía no escribe
        // FALLIDO (llega con los errores permanentes de Resend, W-06).
        this.log.error(`orden ${ordenId}: email de entradas FALLIDO, no se reintenta`);
        return;
      default:
        // El CHECK no deja llegar aquí; si se agrega un estado, TypeScript obliga a tratarlo.
        throw new Error(`orden ${ordenId}: estado de envios_email desconocido ${envio.estado satisfies never}`);
    }

    const filas = await this.datosDe(ordenId);
    // Una orden PAGADA siempre tiene entradas (pagos.service lo verifica en la
    // misma transacción). Si no hay, es un bug: se lanza el error y la fila
    // queda pendiente, visible en outbox.intentos.
    if (filas.length === 0) throw new Error(`orden ${ordenId}: sin entradas EMITIDA`);

    const [primera] = filas;
    const pdf = await generarPdf({
      titulo: primera.titulo,
      inicio: primera.inicio,
      recinto: primera.recinto,
      ciudad: primera.ciudad,
      comprador: primera.nombre,
      entradas: filas.map((f) => ({
        zona: f.zona,
        fila: f.fila,
        columna: f.columna,
        qr: firmarQr({ id: f.entrada_id, eventoId: f.evento_id, emitidaEn: f.emitida_en }, this.clave),
      })),
    });

    let messageId: string;
    try {
      messageId = await this.correo.enviar({
        para: primera.email,
        asunto: `Tus entradas: ${primera.titulo}`,
        texto: `Hola ${primera.nombre}, adjuntamos tus ${filas.length} entrada(s) para ${primera.titulo}. Presenta el QR en la puerta.`,
        adjunto: { nombre: `entradas-${ordenId.slice(0, 8)}.pdf`, contenido: pdf },
      });
    } catch (error) {
      // Sigue PENDIENTE: el outbox no se marca y se reintenta al vencer el lease.
      await this.prisma.$executeRaw`
        UPDATE envios_email SET intentos = intentos + 1
        WHERE orden_id = ${ordenId}::uuid AND tipo = 'ENTRADAS'`;
      throw error;
    }

    await this.prisma.$executeRaw`
      UPDATE envios_email SET estado = 'ENVIADO', intentos = intentos + 1, proveedor_msg_id = ${messageId}
      WHERE orden_id = ${ordenId}::uuid AND tipo = 'ENTRADAS' AND estado = 'PENDIENTE'`;
    this.log.log(`orden ${ordenId}: ${filas.length} entrada(s) enviadas`);
  }

  private datosDe(ordenId: string) {
    return this.prisma.$queryRaw<FilaEntrada[]>`
      SELECT u.email, u.nombre, ev.titulo, ev.inicio, r.nombre AS recinto, c.nombre AS ciudad,
             e.id AS entrada_id, o.evento_id, e.emitida_en, z.nombre AS zona, a.fila, a.columna
      FROM ordenes o
      JOIN usuarios u  ON u.id = o.usuario_id
      JOIN eventos ev  ON ev.id = o.evento_id
      JOIN recintos r  ON r.id = ev.recinto_id
      JOIN ciudades c  ON c.id = r.ciudad_id
      JOIN entradas e  ON e.orden_id = o.id AND e.estado = 'EMITIDA'
      JOIN asientos a  ON a.id = e.asiento_id
      JOIN zonas z     ON z.id = a.zona_id
      WHERE o.id = ${ordenId}::uuid
      ORDER BY z.nombre, a.fila, a.columna`;
  }
}
