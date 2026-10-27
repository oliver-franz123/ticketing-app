import type { ConfigService } from '@nestjs/config';
import type { MockInstance } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { SimuladorPagosService } from './simulador-pagos.service';

const SECRETO = 'secreto-de-prueba-del-simulador-32-bytes!!';

// ConfigService de mentira: solo las variables del caso (más el secreto, que
// el constructor exige). onModuleInit no toca la BD.
const servicio = (variables: Record<string, string>) => {
  const valores: Record<string, string> = { SIMULADOR_WEBHOOK_SECRET: SECRETO, ...variables };
  const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService;
  return new SimuladorPagosService({} as PrismaService, config);
};

describe('SimuladorPagosService.onModuleInit: el tick del despacho', () => {
  let setIntervalEspia: MockInstance<typeof setInterval>;

  beforeEach(() => {
    // Timers falsos: el tick nunca corre de verdad; solo se mira si se creó y cada cuánto.
    vi.useFakeTimers();
    setIntervalEspia = vi.spyOn(globalThis, 'setInterval');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const intervalos = () => setIntervalEspia.mock.calls.map(([, ms]) => ms);

  it.each([
    ['ausente → 1 s', { NODE_ENV: 'development' }, [1000]],
    ['vacía → 1 s (no se apaga sin avisar)', { NODE_ENV: 'development', SIMULADOR_TICK_MS: '' }, [1000]],
    ['"1000" → 1 s', { NODE_ENV: 'development', SIMULADOR_TICK_MS: '1000' }, [1000]],
    ['"0" → apagado', { NODE_ENV: 'development', SIMULADOR_TICK_MS: '0' }, []],
    ['NODE_ENV=test y ausente → sin timer', { NODE_ENV: 'test' }, []],
    ['NODE_ENV=test y vacía → sin timer', { NODE_ENV: 'test', SIMULADOR_TICK_MS: '' }, []],
    ['NODE_ENV=test y "1000" → 1 s (el valor explícito manda)', { NODE_ENV: 'test', SIMULADOR_TICK_MS: '1000' }, [1000]],
  ])('%s', (_caso, variables, esperado) => {
    const simulador = servicio(variables);
    simulador.onModuleInit();
    expect(intervalos()).toEqual(esperado);
    simulador.onModuleDestroy();
  });

  it.each([
    ['"abc"', 'abc'],
    ['"-5"', '-5'],
  ])('%s → la API no arranca y no se crea ningún timer', (_caso, valor) => {
    const simulador = servicio({ NODE_ENV: 'development', SIMULADOR_TICK_MS: valor });
    expect(() => simulador.onModuleInit()).toThrow('SIMULADOR_TICK_MS tiene que ser un entero >= 0');
    expect(intervalos()).toEqual([]);
  });
});
