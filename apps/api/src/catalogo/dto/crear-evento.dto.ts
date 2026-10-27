import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_ASIENTOS_POR_ZONA, MAX_COLUMNAS, MAX_FILAS, MAX_PRECIO_CENTAVOS } from '../limites';
import { AntesDe, EsFuturo, ISO_CON_ZONA, ProductoMaximo } from './validadores';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const FECHA_CON_ZONA = 'La fecha debe ser ISO 8601 con zona horaria (por ejemplo 2026-11-21T21:00:00-04:00)';

export class ZonaDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la zona es obligatorio' })
  @MaxLength(60)
  nombre!: string;

  // Entero en centavos (ADR-0010): Bs 150,50 se manda como 15050, nunca 150.5.
  @IsInt({ message: 'El precio debe ser un entero en centavos' })
  @Min(0)
  @Max(MAX_PRECIO_CENTAVOS)
  precioCentavos!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_FILAS)
  filas!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_COLUMNAS)
  @ProductoMaximo('filas', MAX_ASIENTOS_POR_ZONA, {
    message: `La zona no puede tener más de ${MAX_ASIENTOS_POR_ZONA} asientos (filas × columnas)`,
  })
  columnas!: number;
}

// Sin `estado` ni `mapaVersion`: con forbidNonWhitelisted, mandarlos da 400.
// Todo evento nace BORRADOR.
export class CrearEventoDto {
  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El título es obligatorio' })
  @MaxLength(200)
  titulo!: string;

  @IsUUID()
  recintoId!: string;

  // Se guardan en UTC (timestamptz) y se muestran en America/La_Paz.
  @Matches(ISO_CON_ZONA, { message: FECHA_CON_ZONA })
  @IsISO8601({ strict: true }, { message: FECHA_CON_ZONA })
  @EsFuturo({ message: 'El evento tiene que ser en el futuro' })
  inicio!: string;

  @Matches(ISO_CON_ZONA, { message: FECHA_CON_ZONA })
  @IsISO8601({ strict: true }, { message: FECHA_CON_ZONA })
  @AntesDe('inicio', { message: 'La venta tiene que abrir antes del inicio del evento' })
  ventaInicio!: string;

  // Solo un ADMIN puede crear a nombre de otro (resolverOrganizador).
  @IsOptional()
  @IsUUID()
  organizadorId?: string;

  @IsDefined({ message: 'La zona es obligatoria' })
  @ValidateNested()
  @Type(() => ZonaDto)
  zona!: ZonaDto;
}
