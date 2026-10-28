'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cerrarSesion, useSesion } from '../lib/sesion';
import { Marca } from './marca';

export function Barra() {
  const sesion = useSesion();
  const router = useRouter();

  return (
    <header className="barra">
      <nav className="barra-interior" aria-label="Principal">
        <Marca />
        {sesion && (sesion.rol === 'VALIDADOR' || sesion.rol === 'ADMIN') && (
          <Link href="/validador" className="enlace-barra">
            Validar
          </Link>
        )}
        {sesion === null && (
          <>
            <Link href="/login" className="enlace-barra">
              Ingresar
            </Link>
            <Link href="/registro" className="enlace-barra">
              Crear cuenta
            </Link>
          </>
        )}
        <a href="#ayuda" className="enlace-barra">
          Ayuda
        </a>
        {sesion && (
          <button
            className="enlace-barra"
            onClick={() => {
              cerrarSesion();
              router.push('/');
            }}
          >
            Salir
          </button>
        )}
      </nav>
    </header>
  );
}
