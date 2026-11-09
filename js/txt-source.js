import { normalizeJob } from './core.js';
// QORVEX Sequence - lectura e índice del TXT de planeación.
// Formato por fila: item@piezas@router@job   (job puede venir vacío)
// Funciona en el navegador (File.stream()) y en Node (fs.createReadStream),
// porque sólo usa un iterable asíncrono de fragmentos (Uint8Array).

export function parseLine(line) {
  const p = line.replace(/\r$/, '').split('@');
  if (p.length < 4) return null;           // línea inválida o vacía
  const [item, piezas, router, job] = p;
  if (!item || !router) return null;
  const qty = Number(piezas);
  return {
    item: item.trim(),
    qty: Number.isFinite(qty) ? qty : 0,
    router: router.trim(),
    job: job.trim(),                        // puede ser '' (job vacío)
  };
}

// Convierte un iterable asíncrono de fragmentos en líneas.
export async function* linesFromChunks(chunks) {
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  for await (const chunk of chunks) {
    carry += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = carry.indexOf('\n')) !== -1) {
      yield carry.slice(0, idx);
      carry = carry.slice(idx + 1);
    }
  }
  carry += decoder.decode();
  if (carry.length) yield carry;
}

// Recorre un TXT y entrega sólo las filas de los routers/jobs seleccionados.
// selection: { routers: Set<string>, jobs?: Set<string> }  (jobs normalizados)
// Si no hay jobs, se traen todas las filas de esos routers.
export async function scanTxt(chunks, selection, sourceName, onMatch) {
  const stats = { total: 0, matched: 0, emptyJob: 0, invalid: 0 };
  for await (const line of linesFromChunks(chunks)) {
    if (!line.trim()) continue;
    stats.total++;
    const row = parseLine(line);
    if (!row) { stats.invalid++; continue; }
    if (!row.job) stats.emptyJob++;
    if (!selection.routers.has(row.router)) continue;
    const jobKey = normalizeJob(row.job);
    if (selection.jobs && !selection.jobs.has(jobKey)) continue;
    stats.matched++;
    onMatch({ ...row, jobKey, source: sourceName });
  }
  return stats;
}

// Búsqueda de jobs que no aparecen en el primer TXT, en todos los TXT de la carpeta.
// files: [{ name, open: () => AsyncIterable<Uint8Array> }] en orden de preferencia.
export async function findJobsAcrossFiles(files, selection, onMatch) {
  const found = new Set();
  for (const f of files) {
    const pending = { routers: selection.routers, jobs: new Set([...selection.jobs].filter(j => !found.has(j))) };
    if (pending.jobs.size === 0) break;
    await scanTxt(f.open(), pending, f.name, row => {
      found.add(row.jobKey);
      onMatch(row);
    });
  }
  const missing = [...selection.jobs].filter(j => !found.has(j));
  return { found, missing };
}
