import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Barra } from './barra';
import './globals.css';

export const metadata: Metadata = {
  title: 'Entradas',
  description: 'Venta de entradas con asientos numerados',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-BO">
      <body>
        <Barra />
        <main>{children}</main>
      </body>
    </html>
  );
}
