import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail({}, { message: 'El email no es válido' })
  email!: string;

  // Sin MinLength: el login no tiene por qué revelar la política de contraseñas.
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MaxLength(128)
  password!: string;
}
