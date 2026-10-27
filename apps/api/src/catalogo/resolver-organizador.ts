import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@entradas/db';
import type { UsuarioAutenticado } from '../auth/tipos';

// El dueño del evento sale del token. Solo un ADMIN puede crear a nombre de
// otro; en ese caso el servicio verifica en la BD que sea un ORGANIZADOR.
export function resolverOrganizador(usuario: UsuarioAutenticado, organizadorId?: string) {
  if (!organizadorId || organizadorId === usuario.id) {
    return { organizadorId: usuario.id, verificarRol: false };
  }
  if (usuario.rol !== Rol.ADMIN) {
    throw new ForbiddenException('Solo puede crear eventos a su nombre');
  }
  return { organizadorId, verificarRol: true };
}
