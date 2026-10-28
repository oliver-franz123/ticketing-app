'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, ErrorApi } from '../../../lib/api';
import { formatearMonto } from '../../../lib/formato';
import { IconoAlerta, IconoCheck, IconoReloj } from '../../iconos';
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
const AVISO_MS = 60_000; // desde aquí la cuenta regresiva se marca como urgente

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
      <div className="pagina-orden">
        <h1>Tu orden</h1>
        <p className="mensaje aviso">
          Tu sesión terminó. <Link href="/login">Ingresa</Link> para ver tu orden.
        </p>
      </div>
    );
  }

  const restante = orden ? Math.max(0, new Date(orden.expiresAt).getTime() - ahora) : 0;
  const minutos = Math.floor(restante / 60000);
  const segundos = Math.floor((restante % 60000) / 1000);
  const vencida = orden?.estado === 'EXPIRADA' || (orden?.estado === 'PENDIENTE_PAGO' && restante === 0);

  const urgente = restante > 0 && restante <= AVISO_MS;

  return (
    <div className="pagina-orden">
      <h1>Tu orden</h1>
      {error && (
        <div className="mensaje error" role="alert">
          {error}{' '}
          <button type="button" className="enlace" onClick={cargar}>
            Reintentar
          </button>
        </div>
      )}
      {!orden && !error && (
        <div className="tarjeta" aria-busy="true">
          <span className="solo-lectores">Cargando tu orden…</span>
          <div className="esqueleto" style={{ height: '1.2em', width: '40%', margin: '0 auto var(--e-4)' }} />
          <div className="esqueleto" style={{ height: '4rem', width: '60%', margin: '0 auto var(--e-4)' }} />
          <div className="esqueleto" style={{ height: 44 }} />
        </div>
      )}

      {orden?.estado === 'PENDIENTE_PAGO' && !vencida && (
        <section className={`tarjeta estado-orden${urgente ? ' urgente' : ''}`}>
          <p className="estado-titulo">Tus asientos están reservados por</p>
          <p className="cuenta" role="timer" aria-label={`Quedan ${minutos} minutos y ${segundos} segundos`}>
            {minutos}:{String(segundos).padStart(2, '0')}
          </p>
          {urgente && (
            <p className="mensaje aviso" role="alert">
              <strong>Quedan menos de 60 segundos.</strong> Paga ahora o tus asientos se liberarán.
            </p>
          )}
          <button className="boton ancho grande" onClick={pagar} disabled={pagando}>
            {pagando ? 'Abriendo el pago…' : `Pagar ${formatearMonto(orden.totalCentavos)}`}
          </button>
          <p className="suave">
            Si ya pagaste, espera aquí: la página se actualiza sola cuando el pago se confirma.
          </p>
        </section>
      )}

      {vencida && (
        <section className="tarjeta estado-orden aviso">
          <span className="estado-icono">
            <IconoReloj />
          </span>
          <h2>Tu reserva venció</h2>
          <p>Pasaron los 5 minutos sin un pago confirmado y los asientos se liberaron para otras personas.</p>
          <Link className="boton" href={`/eventos/${orden!.eventoId}`}>
            Elegir asientos de nuevo
          </Link>
        </section>
      )}

      {orden?.estado === 'PAGADA' && (
        <section className="tarjeta estado-orden ok" role="status">
          <span className="estado-icono">
            <IconoCheck />
          </span>
          <h2>¡Pago confirmado!</h2>
          <p>
            <strong>Revisa tu correo:</strong> te enviamos tus entradas en PDF, con un código QR por asiento. Si no lo
            ves en unos minutos, mira la carpeta de spam.
          </p>
        </section>
      )}

      {orden?.estado === 'REEMBOLSO_REQUERIDO' && (
        <section className="tarjeta estado-orden error" role="status">
          <span className="estado-icono">
            <IconoAlerta />
          </span>
          <h2>Tu pago llegó tarde</h2>
          <p>
            El pago se confirmó cuando tu reserva ya había vencido y otra persona tomó esos asientos. No se emitieron
            entradas y tu orden quedó registrada para el reembolso.
          </p>
        </section>
      )}

      {orden && !['PENDIENTE_PAGO', 'PAGADA', 'EXPIRADA', 'REEMBOLSO_REQUERIDO'].includes(orden.estado) && (
        <p className="mensaje aviso">Estado de la orden: {orden.estado}. Si tienes dudas, contáctanos.</p>
      )}

      {orden && (
        <section className="tarjeta detalle-orden">
          <h2>Detalle</h2>
          <dl>
            <dt>Asientos</dt>
            <dd>
              <ul className="zonas">
                {orden.asientos.map((a) => (
                  <li key={a.id}>
                    Fila {a.fila} · <strong>{a.columna}</strong>
                  </li>
                ))}
              </ul>
            </dd>
            <dt>Total</dt>
            <dd className="detalle-total">{formatearMonto(orden.totalCentavos)}</dd>
          </dl>
          <p className="suave referencia">Orden {orden.ordenId}</p>
        </section>
      )}
    </div>
  );
}
