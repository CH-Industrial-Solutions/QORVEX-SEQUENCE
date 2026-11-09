// Base de ítems: lee "Base de ítems.xlsm" de la carpeta de trabajo (hoja BData: A=ítem, B=descripción, C=familia).
export const NOMBRE_BASE = 'Base de ítems.xlsm';

export async function leerBaseItems(root) {
  let fh;
  try { fh = await root.getFileHandle(NOMBRE_BASE); }
  catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
  const buf = await (await fh.getFile()).arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const hoja = wb.SheetNames.includes('BData') ? 'BData' : wb.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, defval: '' });
  const mapa = new Map();
  for (const r of filas) {
    const item = String(r[0] ?? '').trim();
    if (!item) continue;
    if (/^(partno|item|sku|n[uú]m)/i.test(item)) continue; // encabezado
    const desc = String(r[1] ?? '').trim();
    const fam = String(r[2] ?? '').trim().replace(/\s+/g, ' ');
    if (!mapa.has(item)) mapa.set(item, { descripcion: desc, familia: fam, familias: fam ? [fam] : [] });
    else {
      const rec = mapa.get(item); // mismo ítem en otra fila de la base: se suma su familia
      if (fam && !rec.familias.includes(fam)) rec.familias.push(fam);
      if (!rec.familia) rec.familia = fam;
    }
  }
  return { mapa, hoja, total: mapa.size };
}

export function familiasDe(mapa) {
  const cuenta = new Map();
  for (const rec of mapa.values()) {
    for (const f of rec.familias) cuenta.set(f, (cuenta.get(f) || 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
