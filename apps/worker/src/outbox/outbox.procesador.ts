import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmitirEntradas } from '../entradas/emitir-entradas';
import { RegistrarReembolso } from '../reembolsos/registrar-reembolso';
import { type FilaOutbox, OutboxRepositorio, type TipoOutbox } from './outbox.repositorio';

const INTERVALO_MS_POR_DEFECTO = 1000;

export interface ResultadoFila {
  id: bigint;
  tipo: TipoOutbox;
  // true = procesada y marcada (publicado_en). false = queda para el próximo lease.
  ok: boolean;
}

// Bucle del Worker (ADR-0017): reclama un lote del outbox, despacha cada fila
// a su handler y la marca procesada solo si terminó bien. Sin reintentos
// propios: una fila que falla se reintenta cuando vence su lease.
@Injectable()
export class ProcesadorOutbox implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ProcesadorOutbox.name);
  private tick?: NodeJS.Timeout;
  private enCurso?: Promise<void>;

  constructor(
    private readonly repo: OutboxRepositorio,
    private readonly emitir: EmitirEntradas,
    private readonly reembolso: RegistrarReembolso,
    private readonly config: ConfigService,
  ) {}

  // OUTBOX_INTERVALO_MS=0 apaga el tick (los e2e procesan a mano). Ausente o
  // vacía → 1 s, como SIMULADOR_TICK_MS: Number('') daría 0 y el Worker no
  // procesaría nada sin avisar.
  onModuleInit() {
    const valor = this.config.get<string>('OUTBOX_INTERVALO_MS')?.trim();
    const ms = valor ? Number(valor) : INTERVALO_MS_POR_DEFECTO;
    if (!Number.isInteger(ms) || ms < 0) {
      throw new Error('OUTBOX_INTERVALO_MS tiene que ser un entero >= 0 (0 apaga el procesamiento automático)');
    }
    if (ms > 0) this.tick = setInterval(() => this.tickUnaVez(), ms);
  }

  // Deja terminar el lote en curso: cortarlo a medias no rompe nada (el lease
  // lo cubre), pero así no queda un email enviado sin marcar.
  async onModuleDestroy() {
    clearInterval(this.tick);
    await this.enCurso;
  }

  async procesarLote(): Promise<ResultadoFila[]> {
    const filas = await this.repo.reclamar();
    return Promise.all(filas.map((fila) => this.procesar(fila)));
  }

  // Un tick lento no se solapa con el siguiente en esta instancia; entre
  // instancias lo evita el lease.
  private tickUnaVez() {
    if (this.enCurso) return;
    this.enCurso = this.procesarLote()
      .then(() => undefined)
      .catch((error: Error) => this.log.error(`reclamar el outbox: ${error.message}`))
      .finally(() => (this.enCurso = undefined));
  }

  private async procesar(fila: FilaOutbox): Promise<ResultadoFila> {
    const { id, tipo } = fila;
    try {
      switch (tipo) {
        case 'ENTRADAS_EMITIDAS':
          await this.emitir.ejecutar(fila.payload.ordenId);
          break;
        case 'REEMBOLSO_REQUERIDO':
          await this.reembolso.ejecutar(fila.payload.ordenId);
          break;
        default:
          // El CHECK de outbox.tipo no deja llegar aquí; si se agrega un tipo,
          // TypeScript obliga a darle un handler.
          throw new Error(`tipo de outbox sin handler: ${tipo satisfies never}`);
      }
      await this.repo.marcarProcesado(id);
      return { id, tipo, ok: true };
    } catch (error) {
      this.log.error(
        `outbox ${id} (${tipo}), intento ${fila.intentos}: ${(error as Error).message}. Se reintenta al vencer el lease`,
      );
      return { id, tipo, ok: false };
    }
  }
}
