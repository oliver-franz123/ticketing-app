'use client';

import { useEffect, useState } from 'react';

// Sesión en sessionStorage: sobrevive a recargar y a volver del simulador de
// pagos, y se borra al cerrar la pestaña.
const CLAVE = 'entradas.token';
const EVENTO = 'entradas:sesion';

export type Rol = 'COMPRADOR' | 'ORGANIZADOR' | 'VALIDADOR' | 'ADMIN';
export type Sesion = { token: string; rol: Rol; exp: number };

// Solo para decidir qué mostrar: la API verifica la firma en cada petición.
function decodificar(token: string): Sesion | null {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (typeof payload.rol !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return { token, rol: payload.rol as Rol, exp: payload.exp };
  } catch {
    return null;
  }
}

export function leerSesion(): Sesion | null {
  try {
    const token = sessionStorage.getItem(CLAVE);
    return token ? decodificar(token) : null;
  } catch {
    return null;
  }
}

export function guardarToken(token: string) {
  try {
    sessionStorage.setItem(CLAVE, token);
  } catch {
    // Navegación privada sin storage: la sesión dura lo que la página.
  }
  window.dispatchEvent(new Event(EVENTO));
}

export function cerrarSesion() {
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin storage no hay nada que borrar.
  }
  window.dispatchEvent(new Event(EVENTO));
}

// undefined = todavía no se leyó (primer render, igual en servidor y cliente).
export function useSesion(): Sesion | null | undefined {
  const [sesion, setSesion] = useState<Sesion | null | undefined>(undefined);
  useEffect(() => {
    const actualizar = () => setSesion(leerSesion());
    actualizar();
    window.addEventListener(EVENTO, actualizar);
    return () => window.removeEventListener(EVENTO, actualizar);
  }, []);
  return sesion;
}
