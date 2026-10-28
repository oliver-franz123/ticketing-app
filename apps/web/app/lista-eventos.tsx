'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../lib/api';
import { CIUDADES, formatearFecha } from '../lib/formato';

export type EventoListado = {
  id: string;
  titulo: string;
  inicio: string;
  recinto: { id: string; nombre: string };
  ciudad: { slug: string; nombre: string };
};

// Eventos PUBLICADOS de una ciudad (RF-10). Lo usan el inicio y el validador.
export function useEventos(ciudad: string) {
  const [eventos, setEventos] = useState<EventoListado[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true;
    setEventos(null);
    setError(null);
    api<{ items: EventoListado[] }>(`/eventos?ciudad=${encodeURIComponent(ciudad)}&porPagina=50`)
      .then((r) => vigente && setEventos(r.items))
      .catch((e) => vigente && setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar la lista'));
    return () => {
      vigente = false;
    };
  }, [ciudad]);
  return { eventos, error };
}

export function SelectorCiudad({ valor, cambiar }: { valor: string; cambiar: (slug: string) => void }) {
  return (
    <label>
      Ciudad
      <select value={valor} onChange={(e) => cambiar(e.target.value)}>
        {CIUDADES.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ListaEventos() {
  const [ciudad, setCiudad] = useState('cochabamba');
  const { eventos, error } = useEventos(ciudad);

  return (
    <>
      <h1>Eventos</h1>
      <div className="tarjeta">
        <SelectorCiudad valor={ciudad} cambiar={setCiudad} />
      </div>
      {error && <p className="mensaje error">{error}</p>}
      {!eventos && !error && <p className="suave">Cargando…</p>}
      {eventos?.length === 0 && <p className="suave">No hay eventos a la venta en esta ciudad.</p>}
      {eventos?.map((e) => (
        <Link key={e.id} href={`/eventos/${e.id}`} className="tarjeta" style={{ display: 'block' }}>
          <strong>{e.titulo}</strong>
          <div className="suave">
            {formatearFecha(e.inicio)} · {e.recinto.nombre}, {e.ciudad.nombre}
          </div>
        </Link>
      ))}
    </>
  );
}
