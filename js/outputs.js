// Salidas en PDF, tamaño carta (letter). Formato igual a las hojas del Excel:
// esqueletos en horizontal con JOBS y LINESET verticales; pivot con barra de título; firmas al pie.
// Requiere jsPDF y jspdf-autotable cargados en index.html.
// Logos: js/logos.js (LOGOS_PDF).

const SLOTS = 20;              // columnas de jobs fijas, como la hoja del Excel (01..20)
const AZUL = [0, 96, 224];
const OSCURO = [64, 64, 64];
const BLANCO = [255, 255, 255];
const NEGRO = [0, 0, 0];

function nuevoDoc(orientacion) {
  const { jsPDF } = window.jspdf;
  return new jsPDF({ orientation: orientacion, unit: 'pt', format: 'letter' });
}

function fechaLarga(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())} ${d.getHours() >= 12 ? 'p. m.' : 'a. m.'}`;
}
const MES_ESC = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Encabezado: logo SESÉ a la izquierda, título centrado, logo INTERNATIONAL a la derecha.
function logoEnAltura(doc, logo, x, y, alto, alinear) {
  const ancho = alto * logo.w / logo.h;
  doc.addImage(logo.src, 'PNG', alinear === 'right' ? x - ancho : x, y, ancho, alto);
}
function encabezado(doc, W, titulo) {
  logoEnAltura(doc, LOGOS_PDF.sese, 28, 16, 30, 'left');
  doc.setTextColor(...NEGRO); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(titulo, W / 2, 30, { align: 'center' });
  logoEnAltura(doc, LOGOS_PDF.international, W - 28, 14, 26, 'right');
}

// Marca de agua CH: casi imperceptible, centrada en la parte de abajo de la hoja.
function marcaAgua(doc, W, H) {
  const alto = 90, ancho = alto * LOGOS_PDF.marca.w / LOGOS_PDF.marca.h;
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.06 }));
  doc.addImage(LOGOS_PDF.marca.src, 'PNG', W / 2 - ancho / 2, H - 150, ancho, alto);
  doc.restoreGraphicsState();
}

// Texto del formato del pie: plantilla (con {mes}) + folio asignado por la empresa.
function textoFormato(formato, impreso) {
  const f = formato || {};
  const base = String(f.texto ?? '{mes} ESC').replace(/\{mes\}/g, MES_ESC(impreso));
  const folio = String(f.folio || '').trim();
  return folio ? `${base} ${folio}` : base;
}

// Pie: firmas y fecha de impresión (igual al Excel).
function pie(doc, W, H, impreso, pagina, paginas, formato) {
  const y = H - 46;
  doc.setTextColor(...NEGRO); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.setDrawColor(...NEGRO); doc.setLineWidth(0.5);
  doc.line(28, y - 14, 210, y - 14);
  doc.text('Fecha y Firma Armado de Secuencia', 28, y - 3);
  doc.text(textoFormato(formato, impreso), 28, y + 8);
  doc.text(`Página ${pagina} de ${paginas}`, W / 2, y + 2, { align: 'center' });
  doc.line(W - 28 - 210, y - 14, W - 28, y - 14);
  doc.text('Fecha y Firma Transferido a Línea', W - 28, y - 3, { align: 'right' });
  doc.text('Printed on: ' + fechaLarga(impreso), W - 28, y + 8, { align: 'right' });
}

// Celda rectangular con texto centrado (o rotado 90° para JOBS / LINESET / números de job).
function celda(doc, x, y, w, h, texto, { fondo = null, color = NEGRO, negrita = false, tam = 8, rotar = false, alinear = 'center' } = {}) {
  doc.setDrawColor(...NEGRO); doc.setLineWidth(0.4);
  if (fondo) { doc.setFillColor(...fondo); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h, 'S');
  if (texto === '' || texto == null) return;
  doc.setTextColor(...color); doc.setFont('helvetica', negrita ? 'bold' : 'normal'); doc.setFontSize(tam);
  const t = String(texto);
  if (rotar) {
    doc.text(t, x + w / 2 + tam / 3, y + h - 4, { angle: 90 });
  } else {
    const ax = alinear === 'left' ? x + 3 : alinear === 'right' ? x + w - 3 : x + w / 2;
    const ay = y + h / 2 + tam / 3;
    doc.text(t, ax, ay, { align: alinear });
  }
}

// Esqueletos: una o más hojas por bloque (si la tabla no cabe, continúa en otra hoja).
// Filas de router por hoja de esqueletos (constante del diseño).
const FILAS_ESQ = Math.floor((612 - 62 - 72 - 14 - 60 - 60 - 2 * 13) / 13);

// Parte cada bloque en hojas (si el bloque no cabe, continúa en otra hoja).
function partirEnHojas(bloques) {
  const hojas = [];
  bloques.forEach(b => {
    const trozos = [];
    for (let i = 0; i < Math.max(b.filas.length, 1); i += FILAS_ESQ) trozos.push(b.filas.slice(i, i + FILAS_ESQ));
    trozos.forEach((filas, t) => hojas.push({ b, filas, parte: t + 1, partes: trozos.length }));
  });
  if (!hojas.length) hojas.push({ b: { pagina: 1, jobs: [], filas: [], subtotales: [], total: 0, secuencia: [] }, filas: [], parte: 1, partes: 1 });
  return hojas;
}

// Esqueletos. Si se pasa un documento, las hojas se agregan al final de ese documento (libro único).
export function pdfEsqueletos(bloques, { familia, linea, impreso = new Date(), formato = null, offset = 0, totalPaginas = 0 } = {}, doc = nuevoDoc('landscape')) {
  const W = 792, H = 612;
  const C = { router: 66, sku: 78, dsc: 148, jobs: 14, slot: 20, total: 30 };  // slot 20 pt; dsc llena el ancho carta
  const ALTO_JOBS = 60, ALTO_LINESET = 60, ALTO_FILA = 13, Y_TABLA = 72;
  const hojas = partirEnHojas(bloques);
  const total = totalPaginas || hojas.length;

  hojas.forEach((h, n) => {
    if (n > 0) doc.addPage('letter', 'landscape');
    const { b } = h;
    marcaAgua(doc, W, H);
    encabezado(doc, W, 'ESQUELETOS PARA SECUENCIA');
    const x0 = 28;
    const xSlot = x0 + C.router + C.sku + C.dsc + C.jobs;
    const xTotal = xSlot + SLOTS * C.slot;
    const yR0 = Y_TABLA, yJobs = yR0 + 14, yLs = yJobs + ALTO_JOBS;
    const yCuerpo = yLs + ALTO_LINESET;

    // Fila de números de columna (01..20) y encabezado "Página n / Secuencia"
    celda(doc, x0, yR0, C.router, 14, 'Secuencia', { negrita: true, tam: 8, alinear: 'left' });
    celda(doc, x0 + C.router, yR0, C.sku + C.dsc, 14, String(familia), { negrita: true, tam: 8 });
    celda(doc, x0 + C.router + C.sku + C.dsc, yR0, C.jobs, 14, '');
    for (let s = 0; s < SLOTS; s++) celda(doc, xSlot + s * C.slot, yR0, C.slot, 14, String(s + 1).padStart(2, '0'), { tam: 9, negrita: true });
    celda(doc, xTotal, yR0, C.total, 14, '');
    doc.setTextColor(...NEGRO); doc.setFont('symbol', 'normal'); doc.setFontSize(9);
    doc.text('S', xTotal + C.total / 2, yR0 + 10, { align: 'center' });   // Σ (fuente Symbol)

    // Fila de jobs (rotados)
    celda(doc, x0, yJobs, C.router + C.sku + C.dsc, ALTO_JOBS, '', {});
    doc.setTextColor(...NEGRO); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`Línea ${linea}`, x0 + 6, yJobs + 16);
    doc.setFontSize(9);
    // Icono de camión (trailer) centrado en el espacio sku + dsc
    const anchoCamion = 120, altoCamion = anchoCamion * LOGOS_PDF.camion.h / LOGOS_PDF.camion.w;
    doc.addImage(LOGOS_PDF.camion.src, 'PNG', x0 + C.router + (C.sku + C.dsc - anchoCamion) / 2, yJobs + (ALTO_JOBS - altoCamion) / 2, anchoCamion, altoCamion);
    celda(doc, x0 + C.router + C.sku + C.dsc, yJobs, C.jobs, ALTO_JOBS, 'JOBS', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, rotar: true });
    for (let s = 0; s < SLOTS; s++) {
      const j = b.jobs[s];
      celda(doc, xSlot + s * C.slot, yJobs, C.slot, ALTO_JOBS, j ? j.job : '', { tam: 9, rotar: true });
    }
    celda(doc, xTotal, yJobs, C.total, ALTO_JOBS, 'JOBS', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, rotar: true });

    // Fila de LINESET (rotados) y encabezados de la tabla
    celda(doc, x0, yLs, C.router, ALTO_LINESET, 'Router', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 8, alinear: 'left' });
    celda(doc, x0 + C.router, yLs, C.sku, ALTO_LINESET, 'Sku', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 8, alinear: 'left' });
    celda(doc, x0 + C.router + C.sku, yLs, C.dsc, ALTO_LINESET, 'Dsc.', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 8, alinear: 'left' });
    celda(doc, x0 + C.router + C.sku + C.dsc, yLs, C.jobs, ALTO_LINESET, 'LINESET', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, rotar: true });
    for (let s = 0; s < SLOTS; s++) {
      const j = b.jobs[s];
      celda(doc, xSlot + s * C.slot, yLs, C.slot, ALTO_LINESET, j ? j.lineset : '', { tam: 9, rotar: true });
    }
    celda(doc, xTotal, yLs, C.total, ALTO_LINESET, 'LINESET', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, rotar: true });

    // Cuerpo: un renglón por router + sku
    let y = yCuerpo;
    h.filas.forEach(f => {
      celda(doc, x0, y, C.router, ALTO_FILA, f.router, { alinear: 'left', tam: 7 });
      celda(doc, x0 + C.router, y, C.sku, ALTO_FILA, f.sku, { alinear: 'left', tam: 7 });
      celda(doc, x0 + C.router + C.sku, y, C.dsc, ALTO_FILA, f.desc, { alinear: 'left', tam: 6 });
      celda(doc, x0 + C.router + C.sku + C.dsc, y, C.jobs, ALTO_FILA, '');
      for (let s = 0; s < SLOTS; s++) {
        const c = f.cantidades[s];
        celda(doc, xSlot + s * C.slot, y, C.slot, ALTO_FILA, c == null ? '' : c, { tam: 9 });
      }
      celda(doc, xTotal, y, C.total, ALTO_FILA, f.subtotal, { negrita: true, tam: 7 });
      y += ALTO_FILA;
    });

    // Caja "Página n | total" al pie (ocupa subtotal y secuencia en la última hoja del bloque)
    const altoCaja = h.parte === h.partes ? 2 * ALTO_FILA : ALTO_FILA;
    celda(doc, x0, y, C.router, altoCaja, `Página ${b.pagina} | ${bloques.length}`, { fondo: [191, 191, 191], negrita: true, tam: 7 });

    // Subtotal y secuencia (en la última hoja de cada bloque)
    if (h.parte === h.partes) {
      celda(doc, x0 + C.router, y, C.sku + C.dsc + C.jobs, ALTO_FILA, 'Subtotal', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, alinear: 'right' });
      for (let s = 0; s < SLOTS; s++) {
        const v = b.subtotales[s];
        celda(doc, xSlot + s * C.slot, y, C.slot, ALTO_FILA, v == null ? '' : v, { fondo: OSCURO, color: BLANCO, negrita: true, tam: 9 });
      }
      celda(doc, xTotal, y, C.total, ALTO_FILA, b.total, { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7 });
      y += ALTO_FILA;
      celda(doc, x0 + C.router, y, C.sku + C.dsc + C.jobs, ALTO_FILA, 'Secuencia', { fondo: OSCURO, color: BLANCO, negrita: true, tam: 7, alinear: 'right' });
      for (let s = 0; s < SLOTS; s++) {
        const v = b.secuencia[s];
        celda(doc, xSlot + s * C.slot, y, C.slot, ALTO_FILA, v == null ? '' : v, { fondo: OSCURO, color: BLANCO, negrita: true, tam: 9 });
      }
      celda(doc, xTotal, y, C.total, ALTO_FILA, '', { fondo: OSCURO });
    }

    pie(doc, W, H, impreso, offset + n + 1, total, formato);
  });
  return doc;
}

// Pivot: sumarización por ítem de la familia (sin total, como la hoja Pivot del Excel).
// Pivot. Si se pasa un documento, la hoja se agrega al final de ese documento (libro único).
export function pdfPivot(pivot, { familia, linea, impreso = new Date(), formato = null, offset = 0, totalPaginas = 1 } = {}, doc = null) {
  if (doc) doc.addPage('letter', 'portrait'); else doc = nuevoDoc('portrait');
  const W = 612, H = 792;
  marcaAgua(doc, W, H);
  encabezado(doc, W, 'Sumarización');
  const x = 150, anchoItem = 170, anchoCant = 90, y0 = 80;
  doc.setFillColor(38, 38, 38);
  doc.rect(x, y0, anchoItem + anchoCant, 22, 'F');
  doc.setTextColor(...BLANCO); doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(String(familia), x + 6, y0 + 15);
  doc.text(`Línea ${linea}`, x + anchoItem + anchoCant - 6, y0 + 15, { align: 'right' });

  const body = pivot.filas.map(f => [f.item, String(f.cantidad)]);
  doc.autoTable({
    head: [['Item', 'Cantidad']],
    body,
    startY: y0 + 22,
    theme: 'plain',
    tableWidth: anchoItem + anchoCant,
    margin: { left: x, right: W - x - anchoItem - anchoCant },
    styles: { fontSize: 9, cellPadding: 3, textColor: NEGRO },
    headStyles: { fillColor: [38, 38, 38], textColor: BLANCO, fontStyle: 'normal' },
    columnStyles: { 0: { cellWidth: anchoItem }, 1: { cellWidth: anchoCant, halign: 'right' } },
    didParseCell: d => {
      if (d.section === 'body') d.cell.styles.lineWidth = 0;
    },
  });
  pie(doc, W, H, impreso, offset + 1, totalPaginas, formato);
  return doc;
}

// Libro único: esqueletos y pivot en el mismo PDF (y en el mismo trabajo de impresión).
export function pdfLibro(bloques, pivot, opts = {}) {
  const doc = nuevoDoc('landscape');
  const hojas = partirEnHojas(bloques);
  const totalPaginas = hojas.length + 1;
  pdfEsqueletos(bloques, { ...opts, totalPaginas }, doc);
  pdfPivot(pivot, { ...opts, offset: hojas.length, totalPaginas }, doc);
  return doc;
}

// Etiquetas: 36 por hoja carta (2 columnas x 18 renglones), llenado por columna como la hoja Labels.
export function pdfEtiquetas(paginas) {
  const doc = nuevoDoc('portrait');
  const M = 30, COLS = 2, RENGLONES = 18;
  const W = (612 - 2 * M) / COLS, H = (792 - 2 * M) / RENGLONES;
  paginas.forEach((pagina, p) => {
    if (p > 0) doc.addPage('letter', 'portrait');
    pagina.forEach((et, i) => {
      const col = Math.floor(i / RENGLONES), ren = i % RENGLONES;
      const x = M + col * W, y = M + ren * H;
      doc.setDrawColor(150); doc.rect(x, y, W, H);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(et.texto, x + 6, y + H / 2 + 3);
    });
  });
  return doc;
}

// Guarda el PDF en impresiones/<usuario>/<familia>/<AAAA-MM-DD_HHMM>/<nombre>
function seguro(texto) { return String(texto).trim().replace(/[\\/:*?"<>|]/g, '_'); }
function marcaTiempo(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
// impDir: carpeta base de impresiones (por defecto impresiones dentro de la carpeta de trabajo).
export async function guardarPdf(impDir, usuario, familia, nombre, doc) {
  const dirUsuario = await impDir.getDirectoryHandle(usuario, { create: true });
  const dirFamilia = await dirUsuario.getDirectoryHandle(seguro(familia), { create: true });
  const dirCorrida = await dirFamilia.getDirectoryHandle(marcaTiempo(), { create: true });
  const fh = await dirCorrida.getFileHandle(nombre, { create: true });
  const w = await fh.createWritable();
  await w.write(doc.output('blob'));
  await w.close();
  return `${impDir.name}/${usuario}/${seguro(familia)}/${marcaTiempo()}/${nombre}`;
}

// Abre el diálogo de impresión del navegador con el PDF listo (eliges la impresora y confirmas).
// Si el navegador no permite imprimir desde el marco, abre el PDF en una pestaña para imprimirlo desde ahí.
export function imprimirEnDialogo(doc) {
  const url = doc.output('bloburl');
  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
  marco.src = url;
  document.body.appendChild(marco);
  marco.onload = () => {
    setTimeout(() => {
      try { marco.contentWindow.focus(); marco.contentWindow.print(); }
      catch (e) { window.open(url, '_blank'); }
    }, 400);
  };
  setTimeout(() => marco.remove(), 120000);
}
