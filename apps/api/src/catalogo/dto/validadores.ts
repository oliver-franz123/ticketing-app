import { registerDecorator, type ValidationArguments, type ValidationOptions } from 'class-validator';

// ISO 8601 con zona horaria explícita (Z o ±hh:mm). "2026-11-21T21:00" sin zona
// es ambiguo: ¿hora de Bolivia o UTC? Se rechaza en vez de adivinar.
export const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

const instante = (valor: unknown) => (typeof valor === 'string' ? Date.parse(valor) : NaN);

// Solo valida la regla de negocio; el formato lo revisan @Matches/@IsISO8601.
// Usa el reloj de la API: no decide concurrencia, solo rechaza un error de carga.
export function EsFuturo(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'esFuturo',
      target: objeto.constructor,
      propertyName: propiedad,
      options: opciones,
      validator: { validate: (valor: unknown) => !(instante(valor) <= Date.now()) },
    });
}

export function AntesDe(otra: string, opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'antesDe',
      target: objeto.constructor,
      propertyName: propiedad,
      constraints: [otra],
      options: opciones,
      validator: {
        validate: (valor: unknown, args: ValidationArguments) => {
          const limite = instante((args.object as Record<string, unknown>)[otra]);
          // Si la otra fecha es inválida ya tiene su propio error.
          return Number.isNaN(limite) || instante(valor) < limite;
        },
      },
    });
}

// filas × columnas ≤ máximo. Va en `columnas`, que es el factor que se valida al final.
export function ProductoMaximo(otra: string, maximo: number, opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'productoMaximo',
      target: objeto.constructor,
      propertyName: propiedad,
      constraints: [otra, maximo],
      options: opciones,
      validator: {
        validate: (valor: unknown, args: ValidationArguments) => {
          const factor = (args.object as Record<string, unknown>)[otra];
          if (!Number.isInteger(valor) || !Number.isInteger(factor)) return true;
          return (valor as number) * (factor as number) <= maximo;
        },
      },
    });
}
