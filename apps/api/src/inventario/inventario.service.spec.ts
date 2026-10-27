import type { Prisma } from '@entradas/db';
import { InventarioService } from './inventario.service';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const ZONA = '22222222-2222-4222-8222-222222222222';

// tx falso: solo registra las llamadas a $executeRaw (plantilla + valores).
const txFalso = (filasInsertadas: number) => {
  const llamadas: unknown[][] = [];
  const tx = {
    $executeRaw: (sql: TemplateStringsArray, ...valores: unknown[]) => {
      llamadas.push([sql.join('?'), ...valores]);
      return Promise.resolve(filasInsertadas);
    },
  } as unknown as Pick<Prisma.TransactionClient, '$executeRaw'>;
  return { tx, llamadas };
};

describe('InventarioService.generarGrilla', () => {
  const servicio = new InventarioService({} as never);

  it('inserta toda la grilla en UNA sola sentencia, con 4 parámetros', async () => {
    const { tx, llamadas } = txFalso(3 * 4);

    const total = await servicio.generarGrilla(tx, { eventoId: EVENTO, zonaId: ZONA, filas: 3, columnas: 4 });

    expect(total).toBe(12);
    expect(llamadas).toHaveLength(1);
    const [sql, ...valores] = llamadas[0];
    expect(sql).toMatch(/INSERT INTO asientos/i);
    expect(sql).toMatch(/generate_series/i);
    expect(valores).toEqual([EVENTO, ZONA, ['A', 'B', 'C'], 4]);
  });

  it('la cantidad de parámetros no crece con la grilla (100 × 150)', async () => {
    const { tx, llamadas } = txFalso(100 * 150);
    await servicio.generarGrilla(tx, { eventoId: EVENTO, zonaId: ZONA, filas: 100, columnas: 150 });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toHaveLength(1 + 4);
  });

  it('si la BD inserta otra cantidad, falla (la transacción hace rollback)', async () => {
    const { tx } = txFalso(11);
    await expect(
      servicio.generarGrilla(tx, { eventoId: EVENTO, zonaId: ZONA, filas: 3, columnas: 4 }),
    ).rejects.toThrow(/12/);
  });
});
