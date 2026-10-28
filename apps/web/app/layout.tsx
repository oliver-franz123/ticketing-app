import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Barra } from './barra';
import { Pie } from './pie';
import './globals.css';

// Poppins (OFL, ver fuentes/OFL.txt) desde el repo: next build no necesita internet.
const poppins = localFont({
  src: [
    { path: './fuentes/poppins-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fuentes/poppins-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fuentes/poppins-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fuentes/poppins-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fuentes/poppins-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--fuente-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'YaKache', template: '%s · YaKache' },
  description: 'Entradas con asiento numerado en Cochabamba, sin filas ni sobreventa',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-BO" className={poppins.variable}>
      <body>
        <Barra />
        <main>{children}</main>
        <Pie />
      </body>
    </html>
  );
}
