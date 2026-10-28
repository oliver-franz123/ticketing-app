'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, ErrorApi } from '../lib/api';
import { CIUDADES } from '../lib/formato';
import { IconoFlecha, IconoLupa, IconoUbicacion } from './iconos';
import { TarjetaEvento, TarjetaEventoCargando } from './tarjeta-evento';

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

// Sin tildes ni mayúsculas: "concierto" encuentra "Concierto Ñandú".
const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function ListaEventos() {
  const [ciudad, setCiudad] = useState('cochabamba');
  const [texto, setTexto] = useState('');
  const { eventos, error } = useEventos(ciudad);
  const resultados = useRef<HTMLHeadingElement>(null);
  const nombreCiudad = CIUDADES.find((c) => c.slug === ciudad)?.nombre ?? ciudad;

  // La API no tiene búsqueda: el texto filtra por título la lista ya cargada.
  const filtro = normalizar(texto.trim());
  const visibles = useMemo(
    () => (filtro ? eventos?.filter((e) => normalizar(e.titulo).includes(filtro)) : eventos),
    [eventos, filtro],
  );

  function buscar(e: FormEvent) {
    e.preventDefault();
    resultados.current?.focus();
  }

  return (
    <>
      <section className="hero">
        <div className="hero-mancha uno" aria-hidden="true" />
        <div className="hero-mancha dos" aria-hidden="true" />
        <div className="hero-interior">
          <h1>
            Tus entradas,
            <br />
            sin filas ni sobreventa
          </h1>
          <p>Conciertos, teatro y más en Cochabamba. Elige tu asiento y págalo en minutos.</p>
          <form className="buscador" role="search" onSubmit={buscar}>
            <label className="buscador-texto">
              <span className="solo-lectores">Buscar evento por nombre</span>
              <input
                type="search"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Busca un evento por su nombre"
                autoComplete="off"
              />
            </label>
            <label className="buscador-ciudad">
              <IconoUbicacion />
              <span className="solo-lectores">Ciudad</span>
              <select value={ciudad} onChange={(e) => setCiudad(e.target.value)}>
                {CIUDADES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
            <button className="boton">
              Buscar
              <IconoLupa />
            </button>
          </form>
        </div>
      </section>

      <section className="seccion-eventos" aria-busy={!eventos && !error}>
        <div className="seccion-cabecera">
          <h2 ref={resultados} tabIndex={-1}>
            Eventos populares en {nombreCiudad}
          </h2>
          {filtro && (
            <button type="button" className="enlace-acento" onClick={() => setTexto('')}>
              Ver todos en {nombreCiudad}
              <IconoFlecha />
            </button>
          )}
        </div>

        {error && (
          <div className="mensaje error" role="alert">
            {error}{' '}
            <button type="button" className="enlace" onClick={() => window.location.reload()}>
              Reintentar
            </button>
          </div>
        )}
        {!eventos && !error && (
          <div className="rejilla-eventos">
            <span className="solo-lectores">Cargando eventos…</span>
            {Array.from({ length: 8 }, (_, i) => (
              <TarjetaEventoCargando key={i} />
            ))}
          </div>
        )}
        {eventos?.length === 0 && (
          <p className="vacio">
            <strong>No hay eventos a la venta en {nombreCiudad}</strong>
            Prueba con otra ciudad de la lista.
          </p>
        )}
        {eventos && eventos.length > 0 && visibles?.length === 0 && (
          <p className="vacio">
            <strong>Ningún evento coincide con «{texto.trim()}»</strong>
            Revisa cómo lo escribiste o mira todos los eventos de {nombreCiudad}.
          </p>
        )}
        {visibles && visibles.length > 0 && (
          <div className="rejilla-eventos">
            {visibles.map((e) => (
              <TarjetaEvento key={e.id} evento={e} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
