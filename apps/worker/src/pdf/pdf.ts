import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface DatosPdf {
  titulo: string;
  inicio: Date;
  recinto: string;
  ciudad: string;
  comprador: string;
  entradas: { zona: string; fila: string; columna: number; qr: string }[];
}

// Fechas en UTC en la BD, mostradas en hora de Bolivia (ADR-0010).
const FECHA_BOLIVIA = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz',
  dateStyle: 'full',
  timeStyle: 'short',
});

// Un PDF simple: una página por entrada con sus datos y el QR firmado. Se
// genera en memoria y va adjunto al email; no se guarda en ningún lado.
export async function generarPdf(datos: DatosPdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Entradas: ${datos.titulo}` } });
  const partes: Buffer[] = [];
  doc.on('data', (parte: Buffer) => partes.push(parte));
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
  });

  for (const [i, entrada] of datos.entradas.entries()) {
    if (i > 0) doc.addPage();
    doc.fontSize(22).text(datos.titulo);
    doc.moveDown(0.5).fontSize(12);
    doc.text(FECHA_BOLIVIA.format(datos.inicio));
    doc.text(`${datos.recinto}, ${datos.ciudad}`);
    doc.moveDown();
    doc.fontSize(14).text(`${entrada.zona} · Fila ${entrada.fila} · Asiento ${entrada.columna}`);
    doc.fontSize(11).text(`Titular: ${datos.comprador}`);
    doc.text(`Entrada ${i + 1} de ${datos.entradas.length}`);
    doc.moveDown();
    const png = await QRCode.toBuffer(entrada.qr, { errorCorrectionLevel: 'M', margin: 1, width: 600 });
    doc.image(png, { fit: [260, 260], align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text('Presenta este QR en la puerta. Es válido para un solo ingreso.', { align: 'center' });
  }

  doc.end();
  return terminado;
}
