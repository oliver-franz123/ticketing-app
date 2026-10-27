'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ErrorApi, uuid } from '../../../lib/api';
import { formatearMonto } from '../../../lib/formato';
import { useSesion } from '../../../lib/sesion';

type Asiento = { id: string; zonaId: string; fila: string; columna: number; estado: string };
type Mapa = {
  version: number;
  zonas: { id: string; nombre: string; precioCentavos: number }[];
  asientos: Asiento[];
};

const MAX_ASIENTOS = 6; // límite por orden (doc 02)
const REFRESCO_MS = 5000; // sin WebSocket en la demo: polling (doc 05 §3, respaldo)

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

  return (
    <>
      <p>
        <Link href="/">← Eventos</Link>
      </p>
      <h1>Elige tus asientos</h1>
      {mapa && (
        <p className="suave">
          {mapa.zonas.map((z) => `${z.nombre}: ${formatearMonto(z.precioCentavos)}`).join(' · ')} · hasta{' '}
          {MAX_ASIENTOS} asientos · se actualiza cada {REFRESCO_MS / 1000} s
        </p>
      )}
      <div className="leyenda">
        <span className="l-libre">Libre</span>
        <span className="l-elegido">Tu selección</span>
        <span className="l-ocupado">Ocupado</span>
      </div>
      {!mapa && !error && <p className="suave">Cargando mapa…</p>}
      <div className="mapa tarjeta">
        {filas.map(([fila, asientos]) => (
          <div className="fila" key={fila}>
            <span className="etiqueta">{fila}</span>
            {asientos.map((a) => (
              <button
                key={a.id}
                className={`asiento${elegidos.includes(a.id) ? ' elegido' : ''}`}
                disabled={a.estado !== 'LIBRE'}
                onClick={() => alternar(a)}
                aria-label={`Fila ${a.fila}, asiento ${a.columna}, ${a.estado === 'LIBRE' ? 'libre' : 'ocupado'}`}
                aria-pressed={elegidos.includes(a.id)}
              >
                {a.columna}
              </button>
            ))}
          </div>
        ))}
      </div>
      {error && <p className="mensaje error">{error}</p>}
      <div className="tarjeta">
        <p>
          {elegidos.length} asiento(s) · <strong>{formatearMonto(total)}</strong>
        </p>
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
    </>
  );
}
