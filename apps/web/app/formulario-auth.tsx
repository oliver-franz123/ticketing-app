'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ErrorApi } from '../lib/api';
import { guardarToken } from '../lib/sesion';

// Login y registro comparten el formulario: los dos devuelven {token}.
export function FormularioAuth({ modo }: { modo: 'login' | 'registro' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!datos.telefono) delete datos.telefono;
    setEnviando(true);
    setError(null);
    try {
      const { token } = await api<{ token: string }>(`/auth/${modo}`, { metodo: 'POST', body: datos });
      guardarToken(token);
      router.push('/');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'Ocurrió un error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <h1>{modo === 'login' ? 'Ingresar' : 'Crear cuenta'}</h1>
      <form className="pila tarjeta" onSubmit={enviar}>
        {modo === 'registro' && (
          <label>
            Nombre
            <input name="nombre" required maxLength={100} autoComplete="name" />
          </label>
        )}
        <label>
          Correo electrónico
          <input name="email" type="email" required autoComplete="email" inputMode="email" />
        </label>
        <label>
          Contraseña
          <input
            name="password"
            type="password"
            required
            minLength={modo === 'registro' ? 8 : undefined}
            autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {modo === 'registro' && (
          <label>
            Teléfono (opcional)
            <input name="telefono" type="tel" placeholder="+59170000000" pattern="\+591[0-9]{8}" />
          </label>
        )}
        {error && <p className="mensaje error">{error}</p>}
        <button className="boton" disabled={enviando}>
          {enviando ? 'Enviando…' : modo === 'login' ? 'Ingresar' : 'Crear cuenta'}
        </button>
      </form>
      <p className="suave">
        {modo === 'login' ? (
          <>
            ¿No tienes cuenta? <Link href="/registro">Crea una</Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta? <Link href="/login">Ingresa</Link>
          </>
        )}
      </p>
    </>
  );
}
