import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';

// Lo que recibe la "API del proveedor" al crear un intento (doc 05 §8).
export class CrearPagoSimuladorDto {
  @IsUUID()
  ordenId!: string;

  // Entero en centavos (ADR-0010). Tope: lo que cabe sin perder precisión en JSON.
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  montoCentavos!: number;

  // La tabla solo admite BOB (CHECK): mejor un 400 claro que un 500 del CHECK.
  @IsIn(['BOB'])
  moneda!: string;
}
