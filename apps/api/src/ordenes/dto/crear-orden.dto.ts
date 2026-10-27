import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MAX_ASIENTOS_POR_ORDEN } from '../limites';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Sin usuarioId, estado ni totalCentavos: el dueño sale del token y el total lo
// calcula la BD con el precio de cada zona (RN-05). Con forbidNonWhitelisted,
// mandarlos da 400.
export class CrearOrdenDto {
  @IsUUID()
  eventoId!: string;

  // RN-03: de 1 a 6 asientos, sin repetir.
  @IsArray()
  @ArrayMinSize(1, { message: 'Hay que elegir al menos un asiento' })
  @ArrayMaxSize(MAX_ASIENTOS_POR_ORDEN, { message: `No se pueden reservar más de ${MAX_ASIENTOS_POR_ORDEN} asientos` })
  @ArrayUnique({ message: 'Hay asientos repetidos' })
  @IsUUID('all', { each: true })
  asientoIds!: string[];

  // Factura futura: la facturación SIN está fuera de alcance, así que no se
  // valida el formato del NIT.
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  nit?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  razonSocial?: string;
}
