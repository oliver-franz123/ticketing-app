import { MODOS_SIMULADOR, type ModoSimulador } from '@entradas/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';

// Formulario de la página del simulador (application/x-www-form-urlencoded:
// todo llega como texto; @Type lo pasa a número antes de validar).
// Cada parámetro es obligatorio solo en su modo y se ignora en los demás.
export class ConfirmarPagoSimuladorDto {
  @IsIn(MODOS_SIMULADOR, { message: `El modo debe ser uno de: ${MODOS_SIMULADOR.join(', ')}` })
  modo!: ModoSimulador;

  // DUPLICAR: copias del MISMO webhook en paralelo. Entre 2 y 10: con 1 no
  // duplica nada, y el tope coincide con el CHECK de la columna veces.
  @ValidateIf((d: ConfirmarPagoSimuladorDto) => d.modo === 'DUPLICAR')
  @Type(() => Number)
  @IsInt({ message: 'veces debe ser un entero' })
  @Min(2)
  @Max(10)
  veces?: number;

  // DEMORA: segundos hasta el envío. Hasta 10 min, el umbral de reconciliación
  // del simulador: una demora mayor la adelantaría la reconciliación.
  @ValidateIf((d: ConfirmarPagoSimuladorDto) => d.modo === 'DEMORA')
  @Type(() => Number)
  @IsInt({ message: 's debe ser un entero' })
  @Min(1)
  @Max(600)
  s?: number;
}
