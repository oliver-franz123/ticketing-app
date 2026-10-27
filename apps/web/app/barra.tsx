'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cerrarSesion, useSesion } from '../lib/sesion';

export function Barra() {
  const sesion = useSesion();
  const router = useRouter();

  return (
    <header className="barra">
      <Link href="/" className="marca">
        Entradas
      </Link>
      <Link href="/">Eventos</Link>
      {sesion && (sesion.rol === 'VALIDADOR' || sesion.rol === 'ADMIN') && <Link href="/validador">Validar</Link>}
      {sesion === null && (
        <>
          <Link href="/login">Ingresar</Link>
          <Link href="/registro">Crear cuenta</Link>
        </>
      )}
      {sesion && (
        <button
          className="enlace"
          onClick={() => {
            cerrarSesion();
            router.push('/');
          }}
        >
          Salir
        </button>
      )}
    </header>
  );
}
