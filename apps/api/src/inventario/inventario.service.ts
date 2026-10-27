import { Injectable } from '@nestjs/common';
import type { Prisma } from '@entradas/db';
import { PrismaService } from '../prisma/prisma.service';
import { etiquetasFilas } from './etiqueta-fila';

export interface AsientoMapa {
  id: string;
  zonaId: string;
  fila: string;
  columna: number;
  estado: string;
}

export interface GrillaZona {
  eventoId: string;
  zonaId: string;
  filas: number;
  columnas: number;
}

export interface ReservaAsientos {
  eventoId: string;
  ordenId: string;
  asientoIds: string[];
  ttlSegundos: number;
}

// Dueño de la tabla asientos (doc 03 §4). Los demás módulos le pasan su
// transacción en vez de escribir asientos por su cuenta.
@Injectable()
export class InventarioService {
  constructor(private readonly prisma: PrismaService) {}

  // Toda la grilla en UNA sentencia y con 4 parámetros, sea de 4 o de 15.000
  // asientos: Postgres arma el producto filas × columnas. Con createMany serían
  // 4 parámetros por asiento, cerca del tope de 65.535 por sentencia.
  // estado, version, orden_id y expires_at salen de los DEFAULT (LIBRE, 0, NULL),
  // que cumplen el CHECK de coherencia.
  async generarGrilla(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, grilla: GrillaZona): Promise<number> {
    const { eventoId, zonaId, filas, columnas } = grilla;
    const insertados = await tx.$executeRaw`
      INSERT INTO asientos (evento_id, zona_id, fila, columna)
      SELECT ${eventoId}::uuid, ${zonaId}::uuid, f.fila, c.columna
      FROM unnest(${etiquetasFilas(filas)}::text[]) AS f(fila)
      CROSS JOIN generate_series(1, ${columnas}::int) AS c(columna)`;

    // Defensa en profundidad: si no cuadra, el error hace rollback de todo.
    if (insertados !== filas * columnas) {
      throw new Error(`Se esperaban ${filas * columnas} asientos y se insertaron ${insertados}`);
    }
    return insertados;
  }

  // Toma los asientos para la orden, todo en UNA sentencia (doc 04 §4.1). Devuelve
  // los que consiguió: si son menos que los pedidos, el llamador hace ROLLBACK.
  // - estado LIBRE o RESERVADO vencido: expiración perezosa, no depende del job.
  // - ORDER BY id: orden fijo de bloqueo, el mismo que la re-captura y el job.
  // - SKIP LOCKED: si otra transacción está tomando el asiento, no se espera;
  //   queda fuera de los candidatos y el comprador recibe 409 al instante.
  // - now() es la hora de inicio de la transacción: expires_at queda igual al de la orden.
  async reservar(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, reserva: ReservaAsientos): Promise<string[]> {
    const { eventoId, ordenId, asientoIds, ttlSegundos } = reserva;
    const tomados = await tx.$queryRaw<{ id: string }[]>`
      WITH candidatos AS (
        SELECT id
        FROM asientos
        WHERE evento_id = ${eventoId}::uuid
          AND id = ANY(${asientoIds}::uuid[])
          AND (estado = 'LIBRE' OR (estado = 'RESERVADO' AND expires_at < now()))
        ORDER BY id
        FOR UPDATE SKIP LOCKED
      )
      UPDATE asientos a
      SET estado     = 'RESERVADO',
          orden_id   = ${ordenId}::uuid,
          expires_at = now() + make_interval(secs => ${ttlSegundos}::int),
          version    = a.version + 1
      FROM candidatos c
      WHERE a.id = c.id
      RETURNING a.id`;
    return tomados.map((a) => a.id);
  }

  // Re-captura al confirmar el pago (doc 04 §4.3): vuelve a tomar como VENDIDO
  // los asientos de la orden, en UNA sentencia. Devuelve los que consiguió; si
  // son menos que los de orden_items, el llamador hace ROLLBACK TO SAVEPOINT
  // para que ninguno quede VENDIDO a medias. Un asiento se puede re-capturar si:
  // - sigue RESERVADO con nuestra orden, aunque la reserva haya vencido;
  // - está LIBRE (el job lo liberó y nadie lo tomó);
  // - está RESERVADO por otra orden cuya reserva ya venció (expiración perezosa).
  // Sin SKIP LOCKED: si otra transacción está tocando un asiento, se espera unos
  // ms y Postgres re-evalúa el WHERE. Saltarlo daría un REEMBOLSO_REQUERIDO falso.
  // ORDER BY id: el mismo orden de bloqueo que reservar, así no hay deadlock (C-09).
  async recapturar(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, ordenId: string): Promise<string[]> {
    const vendidos = await tx.$queryRaw<{ id: string }[]>`
      WITH candidatos AS (
        SELECT a.id
        FROM asientos a
        JOIN orden_items oi ON oi.asiento_id = a.id AND oi.orden_id = ${ordenId}::uuid
        WHERE (a.estado = 'RESERVADO' AND a.orden_id = ${ordenId}::uuid)
           OR  a.estado = 'LIBRE'
           OR (a.estado = 'RESERVADO' AND a.expires_at < now())
        ORDER BY a.id
        FOR UPDATE OF a
      )
      UPDATE asientos a
      SET estado     = 'VENDIDO',
          orden_id   = ${ordenId}::uuid,
          expires_at = NULL,
          version    = a.version + 1
      FROM candidatos c
      WHERE a.id = c.id
      RETURNING a.id`;
    return vendidos.map((a) => a.id);
  }

  // Libera los asientos que la orden todavía tenía RESERVADOS (pago tardío sin
  // todos sus asientos, doc 04 §4.3). Mismo patrón de bloqueo: ORDER BY id.
  async liberarDeOrden(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, ordenId: string): Promise<string[]> {
    const liberados = await tx.$queryRaw<{ id: string }[]>`
      WITH nuestros AS (
        SELECT id FROM asientos
        WHERE orden_id = ${ordenId}::uuid AND estado = 'RESERVADO'
        ORDER BY id
        FOR UPDATE
      )
      UPDATE asientos a
      SET estado = 'LIBRE', orden_id = NULL, expires_at = NULL, version = a.version + 1
      FROM nuestros n
      WHERE a.id = n.id
      RETURNING a.id`;
    return liberados.map((a) => a.id);
  }

  // Snapshot del mapa (doc 05). Orden por largo y después por texto: con solo
  // texto, "AA" quedaría antes que "B". Usa el índice asientos(evento_id, estado).
  // La expiración perezosa (estado efectivo, doc 04 §6) llega con las reservas.
  snapshotMapa(eventoId: string, tx: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma): Promise<AsientoMapa[]> {
    return tx.$queryRaw<AsientoMapa[]>`
      SELECT id, zona_id AS "zonaId", fila, columna, estado
      FROM asientos
      WHERE evento_id = ${eventoId}::uuid
      ORDER BY length(fila), fila, columna`;
  }
}
