import { Inject, Injectable } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import type { UsuarioAutenticado } from '../auth/tipos';
import { PrismaService } from '../prisma/prisma.service';
import type { ValidarDto } from './dto/validar.dto';
import { CLAVE_QR_PUBLICA } from './qr/clave-qr';
import { verificarQr } from './qr/qr';

// Mismos valores que el CHECK validaciones_resultado_chk de la migración.
export const ResultadoValidacion = {
  VALIDA: 'VALIDA',
  YA_USADA: 'YA_USADA',
  INVALIDA: 'INVALIDA',
  OTRO_EVENTO: 'OTRO_EVENTO',
} as const;

export type ResultadoValidacion = (typeof ResultadoValidacion)[keyof typeof ResultadoValidacion];

interface EntradaVista {
  estado: string;
  usada_en: Date | null;
  evento_id: string;
}

@Injectable()
export class ValidacionesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLAVE_QR_PUBLICA) private readonly clave: KeyObject,
  ) {}

  // Validación en puerta (doc 04, ADR-0011). La firma dice que el QR es nuestro;
  // la marca USADA la decide Postgres con un CAS, nunca un SELECT previo: con dos
  // validadores a la vez, los dos leerían EMITIDA. Cada intento queda en
  // validaciones, en la misma transacción que la marca.
  async validar(validador: UsuarioAutenticado, { qr, eventoId }: ValidarDto) {
    const payload = verificarQr(qr, this.clave);
    const evento = eventoId.toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      const registrar = async (resultado: ResultadoValidacion, entradaId: string | null, usadaEn?: Date) => {
        await tx.$executeRaw`
          INSERT INTO validaciones (entrada_id, validador_id, resultado)
          VALUES (${entradaId}::uuid, ${validador.id}::uuid, ${resultado})`;
        return usadaEn ? { resultado, usadaEn } : { resultado };
      };

      // Formato, firma o payload malos (A-05): no se sabe de qué entrada es.
      if (!payload) return registrar(ResultadoValidacion.INVALIDA, null);

      // El CAS. El evento sale de la orden en la BD, no del payload: aunque la
      // firma lo garantiza, la fuente de verdad es Postgres. Con 10 escaneos a
      // la vez, los otros 9 esperan el lock de la fila, re-evalúan el WHERE
      // (READ COMMITTED) y ya no la encuentran en EMITIDA.
      const [usada] = await tx.$queryRaw<{ usada_en: Date }[]>`
        UPDATE entradas e
           SET estado = 'USADA', usada_en = now(), usada_por = ${validador.id}::uuid
          FROM ordenes o
         WHERE e.id = ${payload.t}::uuid
           AND o.id = e.orden_id
           AND o.evento_id = ${evento}::uuid
           AND e.estado = 'EMITIDA'
        RETURNING e.usada_en`;
      if (usada) return registrar(ResultadoValidacion.VALIDA, payload.t);

      // No se marcó: se averigua por qué, solo para informar. Esta lectura ya
      // no decide nada.
      const [entrada] = await tx.$queryRaw<EntradaVista[]>`
        SELECT e.estado, e.usada_en, o.evento_id
          FROM entradas e JOIN ordenes o ON o.id = e.orden_id
         WHERE e.id = ${payload.t}::uuid`;
      // Firma válida pero la entrada no existe (otra base, o se borró).
      if (!entrada) return registrar(ResultadoValidacion.INVALIDA, null);
      if (entrada.evento_id !== evento) return registrar(ResultadoValidacion.OTRO_EVENTO, payload.t);
      if (entrada.estado === 'USADA') {
        return registrar(ResultadoValidacion.YA_USADA, payload.t, entrada.usada_en ?? undefined);
      }
      // ANULADA (orden reembolsada): el QR es auténtico pero ya no da acceso.
      return registrar(ResultadoValidacion.INVALIDA, payload.t);
    });
  }
}
