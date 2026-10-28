'use client';

import Link from 'next/link';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../lib/api';
import { formatearFecha } from '../../lib/formato';
import { useSesion } from '../../lib/sesion';
import { IconoAlerta, IconoCheck, IconoX } from '../iconos';
import { SelectorCiudad, useEventos } from '../lista-eventos';

type Resultado = { resultado: 'VALIDA' | 'YA_USADA' | 'INVALIDA' | 'OTRO_EVENTO'; usadaEn?: string };

// Texto e icono además del color: el resultado se entiende sin distinguir colores.
const TEXTO: Record<Resultado['resultado'], { titulo: string; detalle: string; icono: ReactNode }> = {
  VALIDA: { titulo: 'Entrada válida', detalle: 'Puede pasar.', icono: <IconoCheck /> },
  YA_USADA: { titulo: 'Esta entrada ya se usó', detalle: 'No dejes pasar.', icono: <IconoX /> },
  INVALIDA: { titulo: 'QR inválido', detalle: 'El código no es una entrada de YaKache. No dejes pasar.', icono: <IconoX /> },
  OTRO_EVENTO: { titulo: 'Entrada de otro evento', detalle: 'Revisa el evento elegido arriba.', icono: <IconoAlerta /> },
};

// Validación en puerta (doc 05 §9). Sin cámara en la demo: se pega el texto
// del QR (TKT1.…), que es lo mismo que leería el lector.
export default function Validador() {
  const sesion = useSesion();
  const [ciudad, setCiudad] = useState('cochabamba');
  const { eventos, error: errorEventos } = useEventos(ciudad);
  const [eventoId, setEventoId] = useState('');
  const [qr, setQr] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Al cambiar de ciudad, el primer evento de la lista.
  useEffect(() => {
    setEventoId(eventos?.[0]?.id ?? '');
  }, [eventos]);

  if (sesion === undefined) {
    return (
      <div className="pagina-validador">
        <h1>Validar entradas</h1>
        <p className="suave">Cargando…</p>
      </div>
    );
  }
  if (!sesion || (sesion.rol !== 'VALIDADOR' && sesion.rol !== 'ADMIN')) {
    return (
      <div className="pagina-validador">
        <h1>Validar entradas</h1>
        <p className="mensaje aviso">
          Esta página es para validadores. <Link href="/login">Ingresa</Link> con una cuenta de validador.
        </p>
      </div>
    );
  }

  async function validar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    setResultado(null);
    try {
      setResultado(
        await api<Resultado>('/validaciones', { metodo: 'POST', token: sesion!.token, body: { qr: qr.trim(), eventoId } }),
      );
      setQr('');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo validar');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pagina-validador">
      <h1>Validar entradas</h1>
      <p className="suave">Elige el evento en el que trabajas y pega el contenido del QR.</p>
      <form className="pila tarjeta" onSubmit={validar}>
        <SelectorCiudad valor={ciudad} cambiar={setCiudad} />
        <label>
          Evento en el que trabajas
          <select value={eventoId} onChange={(e) => setEventoId(e.target.value)} required disabled={!eventos?.length}>
            {!eventos && !errorEventos && <option value="">Cargando eventos…</option>}
            {errorEventos && <option value="">No se pudieron cargar los eventos</option>}
            {eventos?.length === 0 && <option value="">No hay eventos en esta ciudad</option>}
            {eventos?.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.titulo} · {formatearFecha(ev.inicio)}
              </option>
            ))}
          </select>
        </label>
        {errorEventos && (
          <p className="mensaje error" role="alert">
            {errorEventos}
          </p>
        )}
        <label>
          Contenido del QR
          <textarea
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            placeholder="TKT1.…"
            required
            spellCheck={false}
            autoCapitalize="off"
          />
        </label>
        <button className="boton ancho grande" disabled={enviando || !eventoId || !qr.trim()}>
          {enviando ? 'Validando…' : 'Validar'}
        </button>
      </form>
      {error && (
        <p className="mensaje error" role="alert">
          {error}
        </p>
      )}
      {resultado && (
        <div className={`resultado ${resultado.resultado}`} role="status">
          <span className="resultado-icono">{TEXTO[resultado.resultado].icono}</span>
          <strong>{TEXTO[resultado.resultado].titulo}</strong>
          <span>{TEXTO[resultado.resultado].detalle}</span>
          {resultado.usadaEn && <span>Usada: {formatearFecha(resultado.usadaEn)}</span>}
        </div>
      )}
    </div>
  );
}
