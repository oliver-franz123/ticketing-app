'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ErrorApi, uuid } from '../../../lib/api';
import { formatearMonto } from '../../../lib/formato';
import { IconoFlecha } from '../../iconos';
import { useSesion } from '../../../lib/sesion';

type Asiento = { id: string; zonaId: string; fila: string; columna: number; estado: string };
type Mapa = {
  version: number;
  zonas: { id: string; nombre: string; precioCentavos: number }[];
  asientos: Asiento[];
};

const MAX_ASIENTOS = 6; // límite por orden (doc 02)
const REFRESCO_MS = 5000; // sin WebSocket en la demo: polling (doc 05 §3, respaldo)

// Estado del asiento en la API → clase CSS y texto para lectores de pantalla.
// Cada estado se distingue también por forma (borde punteado, X), no solo por color.
const CLASE: Record<string, string> = { LIBRE: 'libre', RESERVADO: 'reservado', VENDIDO: 'vendido' };
const ESTADO_LEGIBLE: Record<string, string> = { LIBRE: 'libre', RESERVADO: 'reservado', VENDIDO: 'vendido' };

export default function MapaEvento() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sesion = useSesion();
  const [mapa, setMapa] = useState<Mapa | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reservando, setReservando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const nuevo = await api<Mapa>(`/eventos/${id}/asientos`);
      setMapa(nuevo);
      // Si alguien tomó un asiento elegido mientras tanto, se suelta solo.
      const libres = new Set(nuevo.asientos.filter((a) => a.estado === 'LIBRE').map((a) => a.id));
      setElegidos((prev) => prev.filter((a) => libres.has(a)));
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar el mapa');
    }
  }, [id]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const filas = useMemo(() => {
    const porFila = new Map<string, Asiento[]>();
    for (const a of mapa?.asientos ?? []) porFila.set(a.fila, [...(porFila.get(a.fila) ?? []), a]);
    return [...porFila.entries()];
  }, [mapa]);

  const precio = useMemo(() => new Map(mapa?.zonas.map((z) => [z.id, z.precioCentavos])), [mapa]);
  const total = elegidos.reduce((s, a) => {
    const asiento = mapa?.asientos.find((x) => x.id === a);
    return s + (asiento ? (precio.get(asiento.zonaId) ?? 0) : 0);
  }, 0);

  function alternar(a: Asiento) {
    setError(null);
    setElegidos((prev) =>
      prev.includes(a.id) ? prev.filter((x) => x !== a.id) : prev.length < MAX_ASIENTOS ? [...prev, a.id] : prev,
    );
  }

  async function reservar() {
    if (!sesion) return;
    setReservando(true);
    setError(null);
    try {
      const orden = await api<{ ordenId: string }>('/ordenes', {
        metodo: 'POST',
        token: sesion.token,
        // Una clave por intento: si la red corta y se reintenta, la API devuelve la misma orden.
        headers: { 'Idempotency-Key': uuid() },
        body: { eventoId: id, asientoIds: elegidos },
      });
      router.push(`/ordenes/${orden.ordenId}`);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'ASIENTOS_NO_DISPONIBLES') {
        setError('Alguien ganó uno de esos asientos hace un instante. Elige otros.');
        cargar();
      } else if (e instanceof ErrorApi && e.codigo === 'ORDEN_PENDIENTE_EXISTENTE') {
        setError('Ya tienes una reserva pendiente en este evento. Págala o espera a que venza.');
      } else {
        setError(e instanceof ErrorApi ? e.message : 'No se pudo reservar');
      }
      setReservando(false);
    }
  }

  const nombres = elegidos
    .map((x) => mapa?.asientos.find((a) => a.id === x))
    .filter((a): a is Asiento => !!a)
    .map((a) => `${a.fila}${a.columna}`);

  return (
    <div className="pagina-evento">
      <Link href="/" className="enlace-acento volver">
        <IconoFlecha />
        Volver a los eventos
      </Link>
      <h1>Elige tus asientos</h1>
      {mapa && mapa.zonas.length > 0 && (
        <ul className="zonas">
          {mapa.zonas.map((z) => (
            <li key={z.id}>
              {z.nombre} <strong>{formatearMonto(z.precioCentavos)}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="suave">
        Hasta {MAX_ASIENTOS} asientos por compra. El mapa se actualiza solo cada {REFRESCO_MS / 1000} s.
      </p>

      <ul className="leyenda" aria-label="Leyenda del mapa">
        <li>
          <span className="asiento muestra libre" aria-hidden="true" />
          Libre
        </li>
        <li>
          <span className="asiento muestra elegido" aria-hidden="true" />
          Tu selección
        </li>
        <li>
          <span className="asiento muestra reservado" aria-hidden="true" />
          Reservado
        </li>
        <li>
          <span className="asiento muestra vendido" aria-hidden="true" />
          Vendido
        </li>
      </ul>

      {error && (
        <div className="mensaje error" role="alert">
          {error}
          {!mapa && (
            <>
              {' '}
              <button type="button" className="enlace" onClick={cargar}>
                Reintentar
              </button>
            </>
          )}
        </div>
      )}

      {!mapa && !error && (
        <div className="mapa tarjeta" aria-busy="true">
          <span className="solo-lectores">Cargando el mapa de asientos…</span>
          <div className="esqueleto" style={{ height: 24, marginBottom: 'var(--e-4)' }} />
          {Array.from({ length: 5 }, (_, i) => (
            <div className="esqueleto" key={i} style={{ height: 'var(--toque-min)', marginBottom: 'var(--e-1)' }} />
          ))}
        </div>
      )}

      {mapa && mapa.asientos.length === 0 && (
        <p className="vacio">
          <strong>Este evento todavía no tiene asientos</strong>
          Vuelve más tarde o elige otro evento.
        </p>
      )}

      {mapa && mapa.asientos.length > 0 && (
        <div className="mapa tarjeta">
          <div className="escenario" aria-hidden="true">
            Escenario
          </div>
          <div className="mapa-filas">
            {filas.map(([fila, asientos]) => (
              <div className="fila" key={fila}>
                <span className="etiqueta" aria-hidden="true">
                  {fila}
                </span>
                {asientos.map((a) => {
                  const estado = elegidos.includes(a.id) ? 'elegido' : (CLASE[a.estado] ?? 'vendido');
                  return (
                    <button
                      key={a.id}
                      className={`asiento ${estado}`}
                      disabled={a.estado !== 'LIBRE'}
                      onClick={() => alternar(a)}
                      aria-label={`Fila ${a.fila}, asiento ${a.columna}, ${estado === 'elegido' ? 'seleccionado' : (ESTADO_LEGIBLE[a.estado] ?? 'no disponible')}`}
                      aria-pressed={elegidos.includes(a.id)}
                    >
                      {a.columna}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="resumen">
        <div className="resumen-interior">
          <div className="resumen-texto" aria-live="polite">
            <span className="suave">
              {elegidos.length === 0
                ? 'Ningún asiento elegido'
                : `${elegidos.length} ${elegidos.length === 1 ? 'asiento' : 'asientos'}: ${nombres.join(', ')}`}
            </span>
            <strong className="resumen-total">{formatearMonto(total)}</strong>
          </div>
          {sesion === null ? (
            <Link className="boton" href="/login">
              Ingresa para reservar
            </Link>
          ) : sesion && sesion.rol !== 'COMPRADOR' ? (
            <p className="mensaje aviso">Solo una cuenta de comprador puede reservar.</p>
          ) : (
            <button className="boton" disabled={!elegidos.length || reservando || !sesion} onClick={reservar}>
              {reservando ? 'Reservando…' : 'Reservar por 5 minutos'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
