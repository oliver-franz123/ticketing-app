import { Marca } from './marca';

// Pie oscuro con la ayuda (el enlace "Ayuda" de la barra apunta a #ayuda).
export function Pie() {
  return (
    <footer className="pie">
      <div className="pie-interior">
        <Marca />
        <p className="pie-lema">Entradas con asiento numerado en Cochabamba, sin filas ni sobreventa.</p>
        <h2 id="ayuda">Ayuda</h2>
        <ul className="ayuda">
          <li>
            <strong>Cómo reservar</strong>
            <p>Elige tu ciudad y el evento, toca hasta 6 asientos libres e ingresa con tu cuenta para reservarlos.</p>
          </li>
          <li>
            <strong>Tienes 5 minutos</strong>
            <p>La reserva guarda tus asientos 5 minutos. Si no pagas a tiempo, se liberan para otras personas.</p>
          </li>
          <li>
            <strong>Si el pago falla</strong>
            <p>
              Tu orden sigue pendiente y puedes intentar de nuevo mientras quede tiempo. Si el pago se confirma cuando la
              reserva ya venció y otra persona tomó tus asientos, no se emiten entradas y la orden queda para
              reembolso.
            </p>
          </li>
          <li>
            <strong>Tus entradas</strong>
            <p>Cuando el pago se confirma, te llegan por correo en PDF, con un código QR por asiento.</p>
          </li>
        </ul>
        <p className="pie-final">YaKache · Cochabamba, Bolivia · Precios en bolivianos (Bs)</p>
      </div>
    </footer>
  );
}
