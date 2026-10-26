import { etiquetaFila, etiquetasFilas } from './etiqueta-fila';

describe('etiquetaFila', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [52, 'AZ'],
    [53, 'BA'],
    [100, 'CV'],
  ])('%i → %s', (n, esperado) => {
    expect(etiquetaFila(n)).toBe(esperado);
  });

  it.each([0, -1, 1.5])('%s no es una fila válida', (n) => {
    expect(() => etiquetaFila(n)).toThrow(RangeError);
  });

  it('etiquetasFilas(3) → A, B, C', () => {
    expect(etiquetasFilas(3)).toEqual(['A', 'B', 'C']);
  });
});
