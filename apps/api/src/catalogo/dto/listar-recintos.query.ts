import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListarRecintosQuery {
  // Mismo criterio que ListarEventosQuery: slug de ciudades, Cochabamba por defecto.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString()
  @MaxLength(80)
  ciudad: string = 'cochabamba';
}
