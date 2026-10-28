import Link from 'next/link';
import { formatearFecha } from '../lib/formato';
import { IconoCalendario, IconoUbicacion } from './iconos';
import type { EventoListado } from './lista-eventos';

// Los eventos no tienen imagen: la cabecera es un degradado oscuro derivado
// del título, así cada evento tiene siempre el mismo color. Son tonos
// generados, no de la paleta: con luminosidad 26 % el blanco da ≥ 5,18 en
// cualquier tono (el peor es el amarillo, 60°).
function degradado(titulo: string) {
  let h = 0;
  for (const c of titulo) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const tono = h % 360;
  return `linear-gradient(135deg, hsl(${tono} 70% 26%), hsl(${(tono + 50) % 360} 75% 18%))`;
}

export function TarjetaEvento({ evento }: { evento: EventoListado }) {
  return (
    <Link href={`/eventos/${evento.id}`} className="tarjeta-evento">
      <div className="tarjeta-evento-imagen" style={{ backgroundImage: degradado(evento.titulo) }} aria-hidden="true">
        <span>{evento.titulo}</span>
      </div>
      <div className="tarjeta-evento-cuerpo">
        <h3>{evento.titulo}</h3>
        <ul className="meta">
          <li>
            <IconoCalendario />
            {formatearFecha(evento.inicio)}
          </li>
          <li>
            <IconoUbicacion />
            {evento.recinto.nombre}, {evento.ciudad.nombre}
          </li>
        </ul>
      </div>
    </Link>
  );
}

export function TarjetaEventoCargando() {
  return (
    <div className="tarjeta-evento" aria-hidden="true">
      <div className="tarjeta-evento-imagen esqueleto" />
      <div className="tarjeta-evento-cuerpo">
        <div className="esqueleto" style={{ height: '1.2em', width: '75%' }} />
        <div className="esqueleto" style={{ height: '0.9em', width: '55%', marginTop: 'var(--e-3)' }} />
        <div className="esqueleto" style={{ height: '0.9em', width: '65%', marginTop: 'var(--e-2)' }} />
      </div>
    </div>
  );
}
