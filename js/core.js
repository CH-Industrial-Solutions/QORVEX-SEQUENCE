// QORVEX Sequence - lógica pura (sin pantalla ni archivos). Replica las macros del Excel.
// Reglas tomadas de: ExtraerPlaneadoV2, Resumir, Pivot, GenerarEsqueleto, Imprimir_EtiquetasV2.

export const FAMILIA_NO_ASIGNADA = 'Kit No Asignado';
export const ETIQUETAS_POR_PAGINA = 36; // 2 columnas x 18 filas, como la hoja Labels

// Quita el prefijo de línea ("2-520202" -> línea "2", valor "520202").
export function splitPrefix(value) {
  const s = String(value ?? '').trim();
  const i = s.indexOf('-');
  return i >= 0 ? { prefix: s.slice(0, i).trim(), value: s.slice(i + 1).trim() } : { prefix: '', value: s };
}

// Clave de comparación de job: sin prefijo y sin ceros a la izquierda.
export function normalizeJob(value) {
  const { value: v } = splitPrefix(value);
  return v.replace(/^0+(?=\d)/, '');
}

// Pegado desde Excel (TSV): columna 1 = job, columna 2 = lineset (opcional). Máximo 1000 filas.
export function parsePlanPaste(text, max = 1000) {
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > max) errors.push(`Solo se toman las primeras ${max} filas (pegaste ${lines.length}).`);
  const rows = lines.slice(0, max).map((line, idx) => {
    const cols = line.split('\t');
    const job = splitPrefix(cols[0]);
    const ls = splitPrefix(cols[1] ?? '');
    return {
      n: idx + 1,
      linea: job.prefix || ls.prefix,
      job: job.value,
      jobKey: normalizeJob(job.value),
      lineset: ls.value,
    };
  });
  const sinJob = rows.filter(r => !r.jobKey).length;
  if (sinJob) errors.push(`${sinJob} fila(s) sin job; se ignorarán.`);
  return { rows: rows.filter(r => r.jobKey), errors };
}

// bdata: Map item -> { descripcion, familia, familias[] }
// Un ítem puede pertenecer a varias familias: devuelve todas. Si no existe en la base: 'Kit No Asignado'.
export function familiasDeItem(item, bdata) {
  const rec = bdata.get(item);
  const lista = rec && rec.familias && rec.familias.length ? rec.familias : (rec && rec.familia ? [rec.familia] : []);
  const limpias = lista.map(f => String(f).trim()).filter(Boolean);
  return limpias.length ? [...new Set(limpias)] : [FAMILIA_NO_ASIGNADA];
}
export function familyOf(item, bdata) {
  return familiasDeItem(item, bdata)[0];
}

// planRows: salida de parsePlanPaste. matches: filas leídas del TXT {item, qty, router, jobKey}.
// Devuelve Planeado (agrupado por job, en el orden del plan) y los jobs no encontrados.
export function buildPlaneado(planRows, matches, bdata) {
  const orden = new Map();
  const linesetPorJob = new Map();
  planRows.forEach((r, i) => {
    if (!orden.has(r.jobKey)) { orden.set(r.jobKey, i); linesetPorJob.set(r.jobKey, r.lineset); }
  });
  const grupos = new Map();
  for (const m of matches) {
    if (!grupos.has(m.jobKey)) grupos.set(m.jobKey, []);
    grupos.get(m.jobKey).push(m);
  }
  const planeado = [];
  for (const jobKey of [...grupos.keys()].sort((a, b) => orden.get(a) - orden.get(b))) {
    for (const m of grupos.get(jobKey)) {
      for (const familia of familiasDeItem(m.item, bdata)) {
        planeado.push({
          item: m.item,
          qty: m.qty,
          router: m.router,
          job: jobKey,
          lineset: linesetPorJob.get(jobKey) ?? '',
          familia,
        });
      }
    }
  }
  const noEncontrados = [...orden.keys()].filter(k => !grupos.has(k));
  return { planeado, noEncontrados };
}

// Resumir: filas de Planeado de una familia. Descripción desde la base de ítems ("Nuevo" si no existe).
export function buildResumen(planeado, familia, bdata) {
  const fam = String(familia).trim();
  return planeado
    .filter(r => String(r.familia).trim() === fam)
    .map(r => ({
      sku: r.item,
      qty: r.qty,
      router: r.router,
      job: r.job,
      rev: '',
      lineset: r.lineset,
      descripcion: bdata.get(r.item)?.descripcion || 'Nuevo',
      nameKit: fam,
    }));
}

// Pivot: suma de piezas por item (como la hoja Pivot), con total general.
export function buildPivot(resumen) {
  const mapa = new Map();
  for (const r of resumen) mapa.set(r.sku, (mapa.get(r.sku) || 0) + Number(r.qty || 0));
  const filas = [...mapa.entries()].map(([item, cantidad]) => ({ item, cantidad }));
  const total = filas.reduce((a, f) => a + f.cantidad, 0);
  return { filas, total };
}

// Esqueleto: bloques de hasta `capacidad` jobs (1..20). Cada bloque = una hoja/página.
export function buildEsqueletoBlocks(resumen, capacidad, linea, familia) {
  const cap = Number(capacidad);
  if (!(cap >= 1 && cap <= 20)) throw new Error('La capacidad de la facilidad debe estar entre 1 y 20.');
  const jobs = [];
  const linesetDe = new Map();
  for (const r of resumen) {
    if (!linesetDe.has(r.job)) { linesetDe.set(r.job, r.lineset); jobs.push(r.job); }
  }
  const descripcion = new Map();
  for (const r of resumen) if (!descripcion.has(r.sku)) descripcion.set(r.sku, r.descripcion);

  const bloques = [];
  const total = Math.ceil(jobs.length / cap);
  for (let b = 0; b < total; b++) {
    const jobsBloque = jobs.slice(b * cap, (b + 1) * cap);
    const enBloque = new Set(jobsBloque);
    const items = new Map(); // key router|sku -> { router, sku, cells: Map job->qty }
    for (const r of resumen) {
      if (!enBloque.has(r.job)) continue;
      const key = `${r.router}|${r.sku}`;
      if (!items.has(key)) items.set(key, { router: r.router, sku: r.sku, cells: new Map() });
      const it = items.get(key);
      it.cells.set(r.job, (it.cells.get(r.job) || 0) + Number(r.qty || 0));
    }
    const filas = [...items.values()].map(it => {
      const cantidades = jobsBloque.map(j => it.cells.get(j) ?? null);
      return {
        router: it.router,
        sku: it.sku,
        desc: descripcion.get(it.sku) || '',
        cantidades,
        subtotal: cantidades.reduce((a, c) => a + (c ?? 0), 0),
      };
    });
    const subtotales = jobsBloque.map((_, c) => filas.reduce((a, f) => a + (f.cantidades[c] ?? 0), 0));
    bloques.push({
      pagina: b + 1,
      linea,
      familia,
      jobs: jobsBloque.map(j => ({ job: j, lineset: linesetDe.get(j) ?? '' })),
      filas,
      subtotales,
      total: subtotales.reduce((a, s) => a + s, 0),
      secuencia: jobsBloque.map((_, i) => i + 1),
    });
  }
  return bloques;
}

// Etiquetas: un renglón por JOB único; consecutivo 1..consMax que vuelve a 1 (igual que Imprimir_EtiquetasV2).
export function buildEtiquetas(resumen, consMax) {
  const max = Number(consMax);
  if (!(max >= 1)) throw new Error('La cantidad máxima de consecutivos debe ser mayor a 0.');
  const vistos = new Map();
  for (const r of resumen) {
    if (!vistos.has(r.job)) vistos.set(r.job, { job: r.job, lineset: r.lineset, sku: r.sku });
  }
  let cons = 1;
  return [...vistos.values()].map(j => {
    const etiqueta = { cons, lineset: j.lineset, job: j.job, sku: j.sku, texto: `Cons: ${cons} // LN: ${j.lineset} // JOB: ${j.job}` };
    cons = cons >= max ? 1 : cons + 1;
    return etiqueta;
  });
}

export function paginarEtiquetas(etiquetas, porPagina = ETIQUETAS_POR_PAGINA) {
  const paginas = [];
  for (let i = 0; i < etiquetas.length; i += porPagina) paginas.push(etiquetas.slice(i, i + porPagina));
  return paginas;
}
