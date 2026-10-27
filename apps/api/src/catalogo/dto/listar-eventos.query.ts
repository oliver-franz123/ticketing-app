import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { EstadoEvento, ESTADOS_PUBLICOS } from '../estados-evento';

export class ListarEventosQuery {
  // RF-10: Cochabamba por defecto. Es el slug de ciudades, nunca texto libre (doc 09 §3).
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(80)
  ciudad: string = 'cochabamba';

  // BORRADOR no está en la lista: el público nunca ve borradores (400).
  @IsOptional()
  @IsIn(ESTADOS_PUBLICOS, { message: `estado debe ser uno de: ${ESTADOS_PUBLICOS.join(', ')}` })
  estado: (typeof ESTADOS_PUBLICOS)[number] = EstadoEvento.PUBLICADO;

  // Los query params llegan como texto: @Type los convierte antes de validar.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  porPagina: number = 20;
}
