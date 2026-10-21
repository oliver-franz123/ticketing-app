import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Sin campo `rol`: con forbidNonWhitelisted, mandarlo da 400. Todo registro
// por la API es COMPRADOR; los demás roles salen de la semilla (RF-03).
export class RegistroDto {
  @Transform(recortar)
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(128)
  password!: string;

  @Transform(recortar)
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @MaxLength(100)
  nombre!: string;

  // Mismo patrón que el CHECK de la tabla usuarios.
  @IsOptional()
  @Matches(/^\+591[0-9]{8}$/, { message: 'El teléfono debe tener el formato +591 seguido de 8 dígitos' })
  telefono?: string;
}
