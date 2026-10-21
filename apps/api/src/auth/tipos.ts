import type { Rol } from '@entradas/db';

// Lo único que viaja en el JWT: IDs opacos y rol, sin datos personales
// (el token se puede decodificar sin la clave).
export interface PayloadJwt {
  sub: string;
  rol: Rol;
  iat?: number;
  exp?: number;
}

export interface UsuarioAutenticado {
  id: string;
  rol: Rol;
}

export interface RequestConUsuario {
  headers: { authorization?: string };
  usuario?: UsuarioAutenticado;
}
