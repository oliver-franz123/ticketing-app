import { MONEDA, ZONA_HORARIA } from '@entradas/shared';

export default function Inicio() {
  return (
    <main>
      <h1>Entradas</h1>
      <p>Venta de entradas con asientos numerados. Lanzamiento en Cochabamba.</p>
      <p>
        Montos en {MONEDA} · horarios en {ZONA_HORARIA}
      </p>
    </main>
  );
}
