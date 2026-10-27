'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../lib/api';
import { formatearFecha } from '../../lib/formato';
import { useSesion } from '../../lib/sesion';
import { SelectorCiudad, useEventos } from '../lista-eventos';

type Resultado = { resultado: 'VALIDA' | 'YA_USADA' | 'INVALIDA' | 'OTRO_EVENTO'; usadaEn?: string };

const TEXTO: Record<Resultado['resultado'], string> = {
  VALIDA: '✓ Entrada válida: puede pasar',
  YA_USADA: '✗ Esta entrada ya se usó',
  INVALIDA: '✗ QR inválido',
  OTRO_EVENTO: '✗ La entrada es de otro evento',
};

// Validación en puerta (doc 05 §9). Sin cámara en la demo: se pega el texto
// del QR (TKT1.…), que es lo mismo que leería el lector.
export default function Validador() {
  const sesion = useSesion();
  const [ciudad, setCiudad] = useState('cochabamba');
  const { eventos } = useEventos(ciudad);
  const [eventoId, setEventoId] = useState('');
  const [qr, setQr] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Al cambiar de ciudad, el primer evento de la lista.
  useEffect(() => {
    setEventoId(eventos?.[0]?.id ?? '');
  }, [eventos]);

  if (sesion === undefined) return null;
  if (!sesion || (sesion.rol !== 'VALIDADOR' && sesion.rol !== 'ADMIN')) {
    return (
      <p className="mensaje aviso">
        Esta página es para validadores. <Link href="/login">Ingresa</Link> con una cuenta de validador.
      </p>
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
    <>
      <h1>Validar entradas</h1>
      <form className="pila tarjeta" onSubmit={validar}>
        <SelectorCiudad valor={ciudad} cambiar={setCiudad} />
        <label>
          Evento en el que trabajas
          <select value={eventoId} onChange={(e) => setEventoId(e.target.value)} required>
            {eventos?.length === 0 && <option value="">No hay eventos en esta ciudad</option>}
            {eventos?.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.titulo} · {formatearFecha(ev.inicio)}
              </option>
            ))}
          </select>
        </label>
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
        <button className="boton" disabled={enviando || !eventoId || !qr.trim()}>
          {enviando ? 'Validando…' : 'Validar'}
        </button>
      </form>
      {error && <p className="mensaje error">{error}</p>}
      {resultado && (
        <div className={`resultado ${resultado.resultado}`} role="status">
          {TEXTO[resultado.resultado]}
          {resultado.usadaEn && <div style={{ fontSize: '1rem', fontWeight: 400 }}>Usada: {formatearFecha(resultado.usadaEn)}</div>}
        </div>
      )}
    </>
  );
}
