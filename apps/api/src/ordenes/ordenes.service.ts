import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { UsuarioAutenticado } from '../auth/tipos';
import { aNumero } from '../catalogo/a-numero';
import { EstadoEvento } from '../catalogo/estados-evento';
import { InventarioService } from '../inventario/inventario.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CrearOrdenDto } from './dto/crear-orden.dto';
import { RESERVA_TTL_SEGUNDOS_POR_DEFECTO } from './limites';

interface EventoALaVenta {
  estado: string;
  venta_abierta: boolean;
  no_empezo: boolean;
}

interface OrdenInsertada {
  id: string;
  expires_at: Date;
  total_centavos: bigint;
}

// Los 409 llevan un `codigo` estable para que la web elija el mensaje.
const conflicto = (codigo: string, message: string, extra: object = {}) =>
  new ConflictException({ statusCode: 409, error: 'Conflict', codigo, message, ...extra });

// Dice QUÉ asientos faltan, nunca de quién son.
const asientosNoDisponibles = (noDisponibles: string[]) =>
  conflicto('ASIENTOS_NO_DISPONIBLES', 'Algunos asientos ya no están disponibles', { noDisponibles });

@Injectable()
export class OrdenesService {
  private readonly ttlSegundos: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventario: InventarioService,
    config: ConfigService,
  ) {
    this.ttlSegundos = Number(config.get('RESERVA_TTL_SEGUNDOS') ?? RESERVA_TTL_SEGUNDOS_POR_DEFECTO);
    if (!Number.isInteger(this.ttlSegundos) || this.ttlSegundos <= 0) {
      throw new Error('RESERVA_TTL_SEGUNDOS tiene que ser un entero positivo');
    }
  }

  // Reserva todo o nada en UNA transacción (doc 04 §4.1). READ COMMITTED, el
  // nivel por defecto: la correctitud la da el UPDATE condicional, no el aislamiento.
  // maxWait: en una carrera, 50 transacciones esperan una de las 10 conexiones del pool.
  crear(usuario: UsuarioAutenticado, clave: string, datos: CrearOrdenDto) {
    const { eventoId, asientoIds } = datos;
    const ordenId = randomUUID();

    return this.prisma.$transaction(
      async (tx) => {
        // A. El evento tiene que estar a la venta. Un BORRADOR da el mismo 404
        // que un id inexistente, como en el mapa. RN-09 con now() de Postgres,
        // nunca con la hora de la API.
        const [evento] = await tx.$queryRaw<EventoALaVenta[]>`
          SELECT estado, venta_inicio <= now() AS venta_abierta, inicio > now() AS no_empezo
          FROM eventos WHERE id = ${eventoId}::uuid`;
        if (!evento || evento.estado === EstadoEvento.BORRADOR) {
          throw new NotFoundException('Evento no encontrado');
        }
        if (evento.estado !== EstadoEvento.PUBLICADO) {
          throw conflicto('EVENTO_NO_DISPONIBLE', 'El evento no está a la venta');
        }
        if (!evento.venta_abierta) throw conflicto('VENTA_NO_ABIERTA', 'La venta todavía no abrió');
        if (!evento.no_empezo) throw conflicto('VENTA_CERRADA', 'La venta cerró: el evento ya empezó');

        // 1. La orden primero: asientos.orden_id es una FK normal (no diferible).
        // El total sale del precio de cada zona al reservar (RN-05). COALESCE: si
        // ningún asiento es del evento, sum da NULL; con 0 se inserta y el paso 2
        // hace el ROLLBACK con 409.
        const [orden] = await tx.$queryRaw<OrdenInsertada[]>`
          INSERT INTO ordenes (id, usuario_id, evento_id, estado, expires_at, extension_usada,
                               idempotency_key, total_centavos, moneda, nit, razon_social)
          VALUES (${ordenId}::uuid, ${usuario.id}::uuid, ${eventoId}::uuid, 'PENDIENTE_PAGO',
                  now() + make_interval(secs => ${this.ttlSegundos}::int), false, ${clave}::uuid,
                  COALESCE((SELECT sum(z.precio_centavos)
                              FROM asientos a JOIN zonas z ON z.id = a.zona_id
                             WHERE a.evento_id = ${eventoId}::uuid AND a.id = ANY(${asientoIds}::uuid[])), 0),
                  'BOB', ${datos.nit ?? null}, ${datos.razonSocial ?? null})
          RETURNING id, expires_at, total_centavos`;

        // 2. Tomar los asientos (UPDATE condicional en Inventario).
        const tomados = await this.inventario.reservar(tx, {
          eventoId,
          ordenId,
          asientoIds,
          ttlSegundos: this.ttlSegundos,
        });

        // 3. Todo o nada (RN-03): si falta uno, la excepción hace ROLLBACK de la
        // orden y de los asientos que sí se tomaron.
        if (tomados.length < asientoIds.length) {
          throw asientosNoDisponibles(asientoIds.filter((id) => !tomados.includes(id)));
        }

        // Precio congelado por asiento (RN-05).
        await tx.$executeRaw`
          INSERT INTO orden_items (orden_id, asiento_id, precio_centavos)
          SELECT ${ordenId}::uuid, a.id, z.precio_centavos
          FROM asientos a JOIN zonas z ON z.id = a.zona_id
          WHERE a.id = ANY(${tomados}::uuid[])`;

        return {
          ordenId,
          eventoId,
          estado: 'PENDIENTE_PAGO',
          asientoIds: [...tomados].sort(),
          totalCentavos: aNumero(orden.total_centavos),
          moneda: 'BOB',
          expiresAt: orden.expires_at,
        };
      },
      { maxWait: 5000, timeout: 5000 },
    );
  }
}
