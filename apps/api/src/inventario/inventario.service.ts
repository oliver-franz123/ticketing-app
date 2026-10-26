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
