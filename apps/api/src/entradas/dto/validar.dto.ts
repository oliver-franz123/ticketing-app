import { IsString, IsUUID, MaxLength } from 'class-validator';

export class ValidarDto {
  // El QR real mide ~230 caracteres; el tope solo evita payloads absurdos.
  @IsString()
  @MaxLength(1024)
  qr!: string;

  // El evento en el que trabaja el validador (lo elige en la web). Recorte de
  // la demo: reemplaza a la asignación evento_validadores (RF-53).
  @IsUUID()
  eventoId!: string;
}
