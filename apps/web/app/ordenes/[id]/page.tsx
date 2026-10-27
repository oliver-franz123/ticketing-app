'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../../lib/api';
import { formatearMonto } from '../../../lib/formato';
import { useSesion } from '../../../lib/sesion';

type Orden = {
  ordenId: string;
  eventoId: string;
  estado: string;
  asientos: { id: string; fila: string; columna: number }[];
  totalCentavos: number;
  expiresAt: string;
};

const REFRESCO_MS = 3000;

export default function PaginaOrden() {
  const { id } = useParams<{ id: string }>();
  const sesion = useSesion();
  const [orden, setOrden] = useState<Orden | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [pagando, setPagando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sesion) return;
    try {
      setOrden(await api<Orden>(`/ordenes/${id}`, { token: sesion.token }));
      setError(null);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar la orden');
    }
  }, [id, sesion]);

  // Polling del estado: la orden pasa a PAGADA cuando llega el webhook, no
  // cuando el navegador vuelve del simulador (doc 05 §4).
  const terminal = orden && orden.estado !== 'PENDIENTE_PAGO';
  useEffect(() => {
    cargar();
    if (terminal) return;
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar, terminal]);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  async function pagar() {
    if (!sesion) return;
    setPagando(true);
    setError(null);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>(`/ordenes/${id}/pago`, {
        metodo: 'POST',
        token: sesion.token,
      });
      window.location.assign(redirectUrl);
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'No se pudo iniciar el pago');
      setPagando(false);
    }
  }

  if (sesion === null) {
    return (
      <p className="mensaje aviso">
        Tu sesión terminó. <Link href="/login">Ingresa</Link> para ver tu orden.
      </p>
    );
  }

  const restante = orden ? Math.max(0, new Date(orden.expiresAt).getTime() - ahora) : 0;
  const minutos = Math.floor(restante / 60000);
  const segundos = Math.floor((restante % 60000) / 1000);
  const vencida = orden?.estado === 'EXPIRADA' || (orden?.estado === 'PENDIENTE_PAGO' && restante === 0);

  return (
    <>
      <h1>Tu orden</h1>
      {error && <p className="mensaje error">{error}</p>}
      {!orden && !error && <p className="suave">Cargando…</p>}
      {orden && (
        <div className="tarjeta">
          <p>
            Asientos: <strong>{orden.asientos.map((a) => `${a.fila}${a.columna}`).join(', ')}</strong>
          </p>
          <p>
            Total: <strong>{formatearMonto(orden.totalCentavos)}</strong>
          </p>
          <p className="suave">Orden {orden.ordenId}</p>
        </div>
      )}

      {orden?.estado === 'PENDIENTE_PAGO' && !vencida && (
        <div className="tarjeta">
          <p>Tus asientos están reservados por:</p>
          <p className="cuenta" aria-live="polite">
            {minutos}:{String(segundos).padStart(2, '0')}
          </p>
          <button className="boton" onClick={pagar} disabled={pagando}>
            {pagando ? 'Abriendo el pago…' : 'Pagar'}
          </button>
          <p className="suave">
            Si ya pagaste, espera aquí: la página se actualiza sola cuando el pago se confirma.
          </p>
        </div>
      )}

      {vencida && (
        <p className="mensaje aviso">
          La reserva venció y los asientos se liberaron. <Link href={`/eventos/${orden!.eventoId}`}>Elegir de nuevo</Link>
        </p>
      )}

      {orden?.estado === 'PAGADA' && (
        <p className="mensaje ok">
          <strong>¡Pago confirmado!</strong> Revisa tu correo: te enviamos tus entradas en PDF con el código QR.
        </p>
      )}

      {orden && !['PENDIENTE_PAGO', 'PAGADA', 'EXPIRADA'].includes(orden.estado) && (
        <p className="mensaje aviso">Estado de la orden: {orden.estado}. Si tienes dudas, contáctanos.</p>
      )}
    </>
  );
}
