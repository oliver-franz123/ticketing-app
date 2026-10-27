import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

// 30 s por fase (conexión, saludo e inactividad del socket): un SMTP colgado
// falla mucho antes de que venza el lease de la fila (LEASE_SEGUNDOS = 120),
// así que otro Worker no la toma mientras esta sigue enviando.
export const SMTP_TIMEOUT_MS = 30_000;

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  adjunto: { nombre: string; contenido: Buffer };
}

// SMTP_URL: Mailpit en local (smtp://localhost:1025). En el entorno
// desplegado, el SMTP del proveedor (smtps://usuario:clave@host:465).
@Injectable()
export class CorreoService implements OnModuleDestroy {
  private readonly transporte: Transporter;
  private readonly remitente: string;

  constructor(config: ConfigService) {
    const valor = config.get<string>('SMTP_URL');
    if (!valor) throw new Error('Falta SMTP_URL (en local: smtp://localhost:1025, Mailpit)');
    const url = new URL(valor);
    const seguro = url.protocol === 'smtps:';
    this.transporte = createTransport({
      host: url.hostname,
      port: Number(url.port) || (seguro ? 465 : 587),
      secure: seguro,
      auth: url.username
        ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
        : undefined,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    this.remitente = config.get<string>('EMAIL_FROM') || 'Entradas <entradas@localhost>';
  }

  // Devuelve el Message-ID, que se guarda en envios_email.proveedor_msg_id.
  async enviar(correo: Correo): Promise<string> {
    const info = await this.transporte.sendMail({
      from: this.remitente,
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      attachments: [{ filename: correo.adjunto.nombre, content: correo.adjunto.contenido, contentType: 'application/pdf' }],
    });
    return info.messageId;
  }

  onModuleDestroy() {
    this.transporte.close();
  }
}
