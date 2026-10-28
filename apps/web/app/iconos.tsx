import type { ReactNode } from 'react';

// Iconos SVG en línea (sin librería): heredan el color del texto con
// currentColor y son decorativos, el texto de al lado dice lo mismo.
function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icono"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconoCalendario = () => (
  <Icono>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </Icono>
);

export const IconoUbicacion = () => (
  <Icono>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icono>
);

export const IconoLupa = () => (
  <Icono>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Icono>
);

export const IconoFlecha = () => (
  <Icono>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icono>
);

export const IconoX = () => (
  <Icono>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icono>
);

export const IconoCheck = () => (
  <Icono>
    <path d="m5 12 5 5 9-10" />
  </Icono>
);

export const IconoReloj = () => (
  <Icono>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icono>
);

export const IconoAlerta = () => (
  <Icono>
    <path d="M12 3 2 20h20L12 3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icono>
);
