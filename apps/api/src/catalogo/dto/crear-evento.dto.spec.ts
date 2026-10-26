// Nest lo carga al arrancar; un DTO probado solo necesita importarlo (@Type lo usa).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CrearEventoDto } from './crear-evento.dto';

const DIA = 24 * 60 * 60 * 1000;
// Fechas relativas a hoy: un test con fechas fijas se rompe cuando quedan en el pasado.
const enDias = (dias: number) => new Date(Date.now() + dias * DIA).toISOString();

const valido = () => ({
  titulo: 'Concierto de Primavera',
  recintoId: '6f1c1a52-6a3b-4b8e-9a51-0c2d6c2b9e11',
  inicio: enDias(30),
  ventaInicio: enDias(1),
  zona: { nombre: 'Platea', precioCentavos: 15050, filas: 5, columnas: 8 },
});

// Rutas de los campos con error, incluidos los anidados ("zona.filas").
const rutas = (errores: ValidationError[], prefijo = ''): string[] =>
  errores.flatMap((e) => {
    const ruta = prefijo + e.property;
    return e.children?.length ? rutas(e.children, `${ruta}.`) : [ruta];
  });

const errores = async (cuerpo: object) => rutas(await validate(plainToInstance(CrearEventoDto, cuerpo)));
const conZona = (zona: object) => ({ ...valido(), zona: { ...valido().zona, ...zona } });

describe('CrearEventoDto', () => {
  it('un cuerpo válido no tiene errores', async () => {
    expect(await errores(valido())).toEqual([]);
  });

  it('acepta fechas con offset de Bolivia (-04:00)', async () => {
    const inicio = new Date(Date.now() + 30 * DIA - 4 * 3600 * 1000).toISOString().replace('Z', '-04:00');
    expect(await errores({ ...valido(), inicio })).toEqual([]);
  });

  describe('límite de la grilla', () => {
    it('100 × 150 = 15.000 asientos: justo en el límite, pasa', async () => {
      expect(await errores(conZona({ filas: 100, columnas: 150 }))).toEqual([]);
    });

    it.each([
      ['0 filas', { filas: 0 }, 'zona.filas'],
      ['101 filas', { filas: 101 }, 'zona.filas'],
      ['0 columnas', { columnas: 0 }, 'zona.columnas'],
      ['201 columnas', { filas: 1, columnas: 201 }, 'zona.columnas'],
      ['100 × 151 = 15.100 asientos', { filas: 100, columnas: 151 }, 'zona.columnas'],
      ['filas decimal', { filas: 2.5 }, 'zona.filas'],
      ['filas como texto', { filas: '10' }, 'zona.filas'],
    ])('%s → error', async (_caso, zona, campo) => {
      expect(await errores(conZona(zona))).toContain(campo);
    });
  });

  describe('precio en centavos', () => {
    it('0 (evento gratuito) pasa', async () => {
      expect(await errores(conZona({ precioCentavos: 0 }))).toEqual([]);
    });

    it.each([
      ['negativo', -1],
      ['decimal (Bs 150,50 mandado como 150.5)', 150.5],
      ['mayor a Bs 100.000', 10_000_001],
      ['texto', '15050'],
    ])('%s → error', async (_caso, precioCentavos) => {
      expect(await errores(conZona({ precioCentavos }))).toContain('zona.precioCentavos');
    });
  });

  describe('fechas', () => {
    // Un mismo instante para el caso "igual": dos llamadas a enDias difieren en ms.
    const en30 = enDias(30);
    it.each([
      ['sin zona horaria (ambigua)', { inicio: enDias(30).replace('Z', ''), ventaInicio: enDias(1) }, 'inicio'],
      ['no es fecha', { inicio: 'mañana', ventaInicio: enDias(1) }, 'inicio'],
      ['inicio en el pasado', { inicio: enDias(-1), ventaInicio: enDias(-2) }, 'inicio'],
      ['venta igual al inicio', { inicio: en30, ventaInicio: en30 }, 'ventaInicio'],
      ['venta después del inicio', { inicio: enDias(30), ventaInicio: enDias(31) }, 'ventaInicio'],
    ])('%s → error', async (_caso, fechas, campo) => {
      expect(await errores({ ...valido(), ...fechas })).toContain(campo);
    });
  });

  it.each([
    ['título vacío', { titulo: '   ' }, 'titulo'],
    ['recintoId no es uuid', { recintoId: '42' }, 'recintoId'],
    ['organizadorId no es uuid', { organizadorId: 'otro' }, 'organizadorId'],
    ['sin zona', { zona: undefined }, 'zona'],
  ])('%s → error', async (_caso, cambio, campo) => {
    expect(await errores({ ...valido(), ...cambio })).toContain(campo);
  });
});
