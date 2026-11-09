// ---- Estado y utilidades ----
const $ = id => document.getElementById(id);
const DEFAULTS = { capacidad: 8, linea: '1', routers: [], catalogo: [], formato: { texto: '{mes} ESC', folio: '' } };
const ROUTERS_BASE = ['Z36', 'Z37', 'Z38', 'Z40']; // siempre cargados; se pueden agregar más
const VISTAS = ['inicio', 'operaciones', 'reportes', 'esqueletos', 'etiquetas', 'bdata', 'config'];
const PADRE = { esqueletos: 'inicio', etiquetas: 'inicio', bdata: 'inicio' }; // pestaña que se ilumina
const state = {
  root: null, txtDir: null, respaldoDir: null, impDir: null, savedRoot: null,
  user: null, nombre: null, rol: null,
  txtFiles: [], routerCounts: new Map(), selected: new Set(), catalogo: new Set(ROUTERS_BASE), cruceRouters: null,
  matches: [], lineaConfirmada: null,
  plan: [], planeado: [], noEncontrados: [], bdata: new Map(), bdataInfo: null,
  familia: null, resumen: null, pivot: null, bloques: null, etiquetas: null,
  lineasCruce: null, ultimoRespaldo: null,
  config: { ...DEFAULTS },
};
const nf = n => Number(n).toLocaleString('es-MX');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setStatus = (el, text, kind = 'ok') => { el.textContent = text; el.className = 'status ' + kind; };
const rutasKey = () => [...state.selected].sort().join(',');

// ---- Navegación ----
function showView(id) {
  const acceso = id === 'view-start' || id === 'view-login';
  $('acceso').hidden = !acceso;
  $('app').hidden = acceso;
  document.body.classList.toggle('modo-acceso', acceso);
  ['view-start', 'view-login', ...VISTAS.map(v => 'view-' + v)].forEach(v => { $(v).hidden = v !== id; });
}
function go(vista) {
  showView('view-' + vista);
  const activa = PADRE[vista] || vista;
  document.querySelectorAll('#nav .tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === activa));
  const pinta = {
    inicio: renderInicio, operaciones: renderOperaciones, reportes: renderReportes,
    esqueletos: renderEsqueletos, etiquetas: renderEtiquetas, bdata: renderBase, config: renderConfig,
  }[vista];
  if (pinta) pinta();
  window.scrollTo(0, 0);
}
document.querySelectorAll('#nav .tab[data-tab]').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});

// ---- Memoria de carpetas (IndexedDB) ----
const DB_NAME = 'qorvex-sequence', STORE = 'kv';
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(key) {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => res(q.result ?? null); q.onerror = () => rej(q.error);
    });
  } catch { return null; }
}
async function kvSet(key, value) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(value, key);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  } catch (e) { console.warn('No se pudo recordar la carpeta:', e); }
}
async function ensureAccess(handle) {
  const opts = { mode: 'readwrite' };
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

// ---- Arranque ----
function iniciarReloj() {
  const pinta = () => {
    const d = new Date();
    $('reloj').textContent = new Intl.DateTimeFormat('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(d);
    $('hdr-fecha').textContent = d.toLocaleDateString('es-MX');
    $('hdr-hora').textContent = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  };
  pinta();
  setInterval(pinta, 15000);
}
async function init() {
  iniciarReloj();
  showView('view-start');
  const saved = await kvGet('root');
  if (saved) {
    $('remembered').hidden = false;
    $('pick-root-wrap').hidden = true;
    $('remembered-name').textContent = saved.name;
    state.savedRoot = saved;
  }
}
async function useRoot(root) {
  state.root = root;
  await kvSet('root', root);
  setStatus($('folder-status'), `Carpeta de trabajo: ${root.name}`, 'ok');
  await showLogin();
}
async function pickRoot() {
  if (!window.showDirectoryPicker) return setStatus($('folder-status'), 'Usa Microsoft Edge (o Chrome).', 'err');
  try { await useRoot(await window.showDirectoryPicker({ mode: 'readwrite' })); }
  catch (e) { if (e.name !== 'AbortError') setStatus($('folder-status'), 'Error: ' + e.message, 'err'); }
}
$('btn-pick-root').addEventListener('click', pickRoot);
$('btn-pick-root2').addEventListener('click', pickRoot);
$('btn-continue').addEventListener('click', async () => {
  try {
    if (!(await ensureAccess(state.savedRoot))) return setStatus($('folder-status'), 'Permiso denegado para la carpeta.', 'err');
    await useRoot(state.savedRoot);
  } catch (e) { setStatus($('folder-status'), 'Error: ' + e.message, 'err'); }
});

// Carpetas: TXT, respaldos e impresiones (por defecto dentro de la carpeta de trabajo).
async function carpetaDe(clave, nombre) {
  const guardada = await kvGet(clave);
  if (guardada && (await ensureAccess(guardada).catch(() => false))) return guardada;
  return state.root.getDirectoryHandle(nombre, { create: true });
}
async function prepararCarpetas() {
  const txt = await kvGet('txt');
  state.txtDir = txt && (await ensureAccess(txt).catch(() => false))
    ? txt : await state.root.getDirectoryHandle('TXT').catch(() => null);
  state.respaldoDir = await carpetaDe('respaldo', 'respaldos');
  state.impDir = await carpetaDe('impresiones', 'impresiones');
}

// ---- Acceso ----
async function showLogin() {
  showView('view-login');
  const { mode } = await accountMode(state.root);
  const crear = mode === 'create';
  $('login-title').textContent = crear ? 'Configuración inicial' : 'Inicio de sesión';
  $('login-hint').textContent = crear
    ? 'Primer uso en esta carpeta. Crea la cuenta del Administrador.'
    : 'Ingresa tu No. de empleado y contraseña.';
  $('campo-nombre').hidden = !crear;
  $('campo-confirmar').hidden = !crear;
  $('user-nombre').required = crear;
  $('user-pass2').required = crear;
  $('btn-login').textContent = crear ? 'Crear administrador' : 'Entrar';
}
function safeLog(action, detail) {
  if (!state.root || !state.user) return Promise.resolve();
  return logAction(state.root, state.user, action, detail).catch(e => console.warn('Registro no guardado:', e));
}
$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    const { mode } = await accountMode(state.root);
    const crear = mode === 'create';
    const name = $('user-name').value, pass = $('user-pass').value;
    if (crear && pass !== $('user-pass2').value) throw new Error('Las contraseñas no coinciden.');
    const u = crear
      ? await createUser(state.root, name, pass, $('user-nombre').value, 'admin')
      : await login(state.root, name, pass);
    state.user = u.name; state.nombre = u.nombre; state.rol = u.rol;
    $('user-pass').value = ''; $('user-pass2').value = '';
    state.config = { ...DEFAULTS, ...(await readJson(state.root, 'configuracion.json', {})) };
    state.selected = new Set(state.config.routers || []);
    state.catalogo = new Set([...ROUTERS_BASE, ...(state.config.catalogo || [])]);
    await prepararCarpetas();
    await cargarBase(true);
    $('hdr-usuario').textContent = state.nombre;
    $('hdr-carpeta').textContent = `Carpeta: ${state.root.name}`;
    $('estado-usuario').textContent = `Usuario: ${state.nombre}`;
    await safeLog(crear ? 'usuario_creado' : 'inicio_sesion');
    go('inicio');
  } catch (err) {
    setStatus($('login-status'), err.message, 'err');
    await showLogin();
  }
});
function resetSesion() {
  state.user = null; state.nombre = null; state.rol = null;
  state.selected = new Set(); state.routerCounts = new Map(); state.cruceRouters = null;
  state.catalogo = new Set(ROUTERS_BASE); state.matches = [];
  state.plan = []; state.planeado = []; state.noEncontrados = []; state.lineasCruce = null;
  state.familia = null; state.resumen = state.pivot = state.bloques = state.etiquetas = null;
  $('plan-paste').value = '';
}
// ---- Tema oscuro / claro (un solo botón; la preferencia se recuerda en este navegador) ----
function aplicarTema(t) {
  document.documentElement.dataset.theme = t === 'claro' ? 'claro' : 'oscuro';
  $('btn-tema').textContent = t === 'claro' ? 'Tema oscuro' : 'Tema claro';
  try { localStorage.setItem('qorvex-tema', document.documentElement.dataset.theme); } catch (e) { /* sin almacenamiento: solo esta sesión */ }
}
$('btn-tema').addEventListener('click', () => aplicarTema(document.documentElement.dataset.theme === 'claro' ? 'oscuro' : 'claro'));
aplicarTema(document.documentElement.dataset.theme);

$('btn-salir').addEventListener('click', async () => {
  await safeLog('cierre_sesion');
  resetSesion();
  await showLogin();
});

// ---- Base de ítems ----
async function cargarBase(silencioso = false) {
  try {
    const base = await leerBaseItems(state.root);
    if (!base) {
      if (!silencioso) setStatus($('base-status'), 'No encuentro "Base de ítems.xlsm" en la carpeta de trabajo.', 'err');
      return false;
    }
    state.bdata = base.mapa;
    state.bdataInfo = base;
    recalcularFamilias();
    if (!silencioso) setStatus($('base-status'), `Base cargada: ${nf(base.total)} ítems (hoja ${base.hoja}).`, 'ok');
    await safeLog('base_cargada', { ítems: base.total, hoja: base.hoja });
    return true;
  } catch (e) {
    if (!silencioso) setStatus($('base-status'), 'Error al leer la base: ' + e.message, 'err');
    return false;
  }
}
$('btn-base').addEventListener('click', () => cargarBase(false));
function renderBase() {
  const familias = familiasDe(state.bdata);
  $('base-stats').innerHTML = state.bdata.size
    ? `<div class="stat"><span class="muted">Ítems</span><b>${nf(state.bdata.size)}</b></div>
       <div class="stat"><span class="muted">Familias</span><b>${familias.length}</b></div>`
    : '';
  pintarBase();
}
function pintarBase() {
  const q = $('base-buscar').value.trim().toUpperCase();
  const filas = [];
  for (const [item, rec] of state.bdata) {
    if (q && !item.toUpperCase().includes(q) && !rec.familia.toUpperCase().includes(q)) continue;
    filas.push(`<tr><td>${esc(item)}</td><td>${esc(rec.descripcion)}</td><td>${esc(rec.familia)}</td></tr>`);
    if (filas.length >= 300) break;
  }
  $('base-rows').innerHTML = filas.join('') || '<tr><td colspan="3" class="muted">Sin resultados.</td></tr>';
}
$('base-buscar').addEventListener('input', pintarBase);

// Familias por ítem: se recalcula el Planeado con la base cargada.
function recalcularFamilias() {
  if (state.matches.length) {
    state.planeado = buildPlaneado(state.plan, state.matches, state.bdata).planeado;
  }
  if (state.familia && !familiasDisponibles().some(([f]) => f === state.familia)) state.familia = null;
}
function familiasDisponibles() {
  const cuenta = new Map();
  for (const r of state.planeado) cuenta.set(r.familia, (cuenta.get(r.familia) || 0) + 1);
  return [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

// ---- TXT ----
async function ensureTxt() {
  if (!state.txtDir) {
    state.txtDir = await window.showDirectoryPicker({ mode: 'read' });
    await kvSet('txt', state.txtDir);
  }
  if (state.txtFiles.length === 0) {
    const files = [];
    for await (const [name, handle] of state.txtDir.entries()) {
      if (handle.kind === 'file' && /\.txt$/i.test(name)) files.push({ name, file: await handle.getFile() });
    }
    files.sort((a, b) => {
      const pa = /^Planned_Trans/i.test(a.name) ? 0 : 1;
      const pb = /^Planned_Trans/i.test(b.name) ? 0 : 1;
      return pa - pb || b.file.lastModified - a.file.lastModified;
    });
    state.txtFiles = files;
  }
  return state.txtFiles;
}
async function countRouters(stream) {
  const counts = new Map();
  for await (const line of linesFromChunks(stream)) {
    const row = parseLine(line);
    if (!row) continue;
    counts.set(row.router, (counts.get(row.router) || 0) + 1);
  }
  return counts;
}

// ---- Operaciones: routers ----
function renderRouters() {
  const chips = new Map(state.routerCounts);
  for (const r of [...state.catalogo, ...state.selected]) if (!chips.has(r)) chips.set(r, null);
  const entries = [...chips.entries()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0) || a[0].localeCompare(b[0]));
  $('router-chips').innerHTML = entries.map(([r, n]) =>
    `<span class="chip ${state.selected.has(r) ? 'on' : ''}" data-r="${esc(r)}" title="${n == null ? 'agregado a mano' : nf(n) + ' filas'}">${esc(r)}${n == null ? '' : ' · ' + nf(n)}</span>`).join('')
    || '<span class="muted">Todavía no hay routers. Lee el TXT o agrega uno.</span>';
  $('router-chips').querySelectorAll('.chip').forEach(el => el.addEventListener('click', () => toggleRouter(el.dataset.r)));
  $('router-selected').textContent = state.selected.size
    ? `Seleccionados (${state.selected.size}): ${[...state.selected].join(', ')}`
    : 'Ningún router seleccionado.';
}
function toggleRouter(r) {
  state.selected.has(r) ? state.selected.delete(r) : state.selected.add(r);
  renderRouters();
  updateLoadInfo();
  safeLog('seleccion_router', { router: r, activo: state.selected.has(r) });
}
$('btn-read-routers').addEventListener('click', async () => {
  try {
    setStatus($('index-status'), 'Leyendo…', 'warn');
    const files = await ensureTxt();
    if (!files.length) return setStatus($('index-status'), 'No hay archivos .txt en la carpeta de TXT.', 'err');
    const t0 = performance.now();
    state.routerCounts = await countRouters(files[0].file.stream());
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const total = [...state.routerCounts.values()].reduce((a, b) => a + b, 0);
    setStatus($('index-status'), `${state.routerCounts.size} routers en ${secs} s · ${nf(total)} filas (${files[0].name})`, 'ok');
    await safeLog('leer_txt', { archivo: files[0].name, filas: total, routers: state.routerCounts.size });
    renderRouters();
  } catch (e) { if (e.name !== 'AbortError') setStatus($('index-status'), 'Error: ' + e.message, 'err'); }
});
$('btn-add-router').addEventListener('click', () => {
  const r = $('router-add').value.trim().toUpperCase();
  if (!r) return;
  state.selected.add(r);
  state.catalogo.add(r);
  $('router-add').value = '';
  renderRouters();
  updateLoadInfo();
  safeLog('router_agregado', { router: r });
});
$('router-add').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('btn-add-router').click(); } });

// ---- Operaciones: jobs pegados ----
function renderPlan(text) {
  const { rows, errors } = parsePlanPaste(text);
  state.plan = rows;
  $('plan-count').textContent = `${rows.length} fila(s) válidas`;
  $('plan-rows').innerHTML = rows.slice(0, 200).map(r =>
    `<tr><td>${r.n}</td><td>${esc(r.linea) || '—'}</td><td>${esc(r.job)}</td><td>${esc(r.lineset) || '—'}</td></tr>`).join('');
  $('plan-wrap').hidden = rows.length === 0;
  setStatus($('plan-status'), errors.join(' '), errors.length ? 'warn' : 'ok');
  updateLoadInfo();
}
function updateLoadInfo() {
  $('load-info').textContent = `Routers: ${state.selected.size ? [...state.selected].join(', ') : 'ninguno (elige en Configuración)'} · Jobs pegados: ${nf(state.plan.length)}`;
}
$('plan-paste').addEventListener('input', () => renderPlan($('plan-paste').value));
$('plan-paste').addEventListener('paste', () => setTimeout(() => renderPlan($('plan-paste').value), 0));
$('btn-clip').addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    $('plan-paste').value = text;
    renderPlan(text);
  } catch {
    setStatus($('plan-status'), 'Edge no permitió leer el portapapeles. Haz clic en el cuadro y presiona Ctrl+V.', 'warn');
    $('plan-paste').focus();
  }
});
$('btn-plan-clear').addEventListener('click', () => { $('plan-paste').value = ''; renderPlan(''); });

function renderOperaciones() {
  renderPlan($('plan-paste').value);
}

// ---- Cruce: jobs pegados contra el TXT ----
async function guardarConfig() {
  state.config.routers = [...state.selected];
  state.config.catalogo = [...state.catalogo].filter(r => !ROUTERS_BASE.includes(r));
  await writeJson(state.root, 'configuracion.json', state.config);
}
function aplicarLinea(linea) {
  state.config.linea = linea;
}
$('btn-cruce').addEventListener('click', async () => {
  const st = $('load-status');
  try {
    if (state.selected.size === 0) return setStatus(st, 'Selecciona al menos un router en Configuración.', 'warn');
    if (state.plan.length === 0) return setStatus(st, 'Pega primero los jobs.', 'warn');
    const files = await ensureTxt();
    if (!files.length) return setStatus(st, 'No hay archivos .txt en la carpeta de TXT.', 'err');
    setStatus(st, 'Leyendo TXT…', 'warn');
    const t0 = performance.now();
    const selection = { routers: new Set(state.selected), jobs: new Set(state.plan.map(r => r.jobKey)) };
    const sources = files.map(f => ({ name: f.name, open: () => f.file.stream() }));
    const matches = [];
    await findJobsAcrossFiles(sources, selection, row => matches.push(row));
    const { planeado, noEncontrados } = buildPlaneado(state.plan, matches, state.bdata);
    state.matches = matches;
    state.planeado = planeado;
    state.cruceFecha = new Date();
    state.noEncontrados = noEncontrados;
    state.cruceRouters = rutasKey();
    state.familia = null;
    state.resumen = state.pivot = state.bloques = state.etiquetas = null;

    // Línea: la que traen los jobs encontrados. Si hay mezcla, el usuario confirma.
    const encontrados = new Set(planeado.map(r => r.job));
    const porLinea = new Map();
    for (const r of state.plan) {
      if (!r.linea || !encontrados.has(r.jobKey)) continue;
      if (!porLinea.has(r.linea)) porLinea.set(r.linea, new Set());
      porLinea.get(r.linea).add(r.jobKey);
    }
    state.lineasCruce = [...porLinea.entries()].map(([l, s]) => [l, s.size]).sort((a, b) => b[1] - a[1]);
    state.lineaConfirmada = null;
    if (state.lineasCruce.length === 1) {
      aplicarLinea(state.lineasCruce[0][0]);
      await guardarConfig();
    }

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const jobsOk = state.plan.length - noEncontrados.length;
    setStatus(st, `Cruce listo en ${secs} s. Elige la Secuencia en Inicio.`, 'ok');
    renderCruceResultado(jobsOk);
    await safeLog('extraccion_planeado', { routers: [...state.selected], jobs: state.plan.length, filas: planeado.length, faltantes: noEncontrados.length });
    renderOperaciones();
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(st, 'Error: ' + e.message, 'err');
  }
});
function renderCruceResultado(jobsOk) {
  renderRangoFamilia();
  const fams = familiasDisponibles();
  let aviso = '';
  if (state.lineaConfirmada) {
    aviso = `<p class="muted">Línea detectada: <b>Línea ${esc(state.lineaConfirmada)}</b> (confirmada).</p>`;
  } else if (state.lineasCruce && state.lineasCruce.length > 1) {
    const opciones = state.lineasCruce.map(([l, n]) => `<button class="secondary" data-linea="${esc(l)}">Línea ${esc(l)} (${nf(n)} jobs)</button>`).join(' ');
    aviso = `<div class="aviso">Hay jobs de varias líneas. Confirma cuál usar para esta secuencia:<br>${opciones}</div>`;
  } else if (state.lineasCruce && state.lineasCruce.length === 1) {
    aviso = `<p class="muted">Línea detectada automáticamente: <b>Línea ${esc(state.lineasCruce[0][0])}</b>.</p>`;
  }
  $('load-result').innerHTML = `
    ${aviso}
    <table><tbody>
      <tr><th>Jobs encontrados</th><td>${nf(jobsOk)} de ${nf(state.plan.length)}</td></tr>
      <tr><th>Filas en Planeado</th><td>${nf(state.planeado.length)}</td></tr>
      <tr><th>Familias disponibles</th><td>${fams.map(([f, n]) => `${esc(f)} (${nf(n)})`).join(', ') || '—'}</td></tr>
      <tr><th>Jobs no encontrados</th><td>${state.noEncontrados.length ? esc(state.noEncontrados.join(', ')) : 'ninguno'}</td></tr>
    </tbody></table>`;
}
$('load-result').addEventListener('click', async e => {
  const b = e.target.closest('[data-linea]');
  if (!b) return;
  aplicarLinea(b.dataset.linea);
  state.lineaConfirmada = b.dataset.linea;
  await guardarConfig();
  setStatus($('load-status'), `Línea ${b.dataset.linea} confirmada.`, 'ok');
  renderCruceResultado(state.plan.length - state.noEncontrados.length);
  await safeLog('linea_confirmada', { linea: b.dataset.linea });
});

// ---- Inicio: configuración rápida de entrada ----
// Rango por familia: router, familia, job inicio, job final y fecha del cruce (al pie de Inicio).
function renderRangoFamilia() {
  const cont = $('rango-tabla');
  if (!cont) return;
  if (!state.planeado.length) { cont.innerHTML = '<p class="muted">Haz el cruce para ver el rango por familia.</p>'; return; }
  const grupos = new Map();
  for (const r of state.planeado) {          // planeado ya viene en el orden del plan
    const k = r.router + '|' + r.familia;
    if (!grupos.has(k)) grupos.set(k, { router: r.router, familia: r.familia, inicio: r.job, final: r.job });
    grupos.get(k).final = r.job;
  }
  const fecha = (state.cruceFecha || new Date()).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const filas = [...grupos.values()].sort((a, b) => a.familia.localeCompare(b.familia, 'es') || String(a.router).localeCompare(String(b.router)));
  cont.innerHTML = `<table><thead><tr><th>Router</th><th>Familia</th><th>Job inicio</th><th>Job final</th><th>Fecha</th></tr></thead><tbody>${
    filas.map(g => `<tr><td>${esc(g.router)}</td><td>${esc(g.familia)}</td><td>${esc(g.inicio)}</td><td>${esc(g.final)}</td><td>${fecha}</td></tr>`).join('')
  }</tbody></table>`;
}

function renderInicio() {
  renderRangoFamilia();
  $('inicio-aviso').textContent = state.bdata.size
    ? `Base de ítems cargada: ${nf(state.bdata.size)} ítems.`
    : 'Falta la Base de ítems: colócala en la carpeta de trabajo como "Base de ítems.xlsm" (ver Bases de datos).';

  // Router: uno a la vez; si hay varios seleccionados se muestra "Varios".
  const rutas = [...new Set([...state.catalogo, ...state.routerCounts.keys(), ...state.selected])].sort();
  const sel = [...state.selected];
  let opRouter = '<option value="">— ninguno —</option>'
    + rutas.map(r => `<option value="${esc(r)}" ${sel.length === 1 && sel[0] === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
  if (sel.length > 1) opRouter = `<option value="__varios" selected>Varios (${sel.length}): ${esc(sel.join(', '))}</option>` + opRouter;
  $('q-router').innerHTML = opRouter;

  let opCap = '';
  for (let i = 1; i <= 20; i++) opCap += `<option value="${i}" ${i === Number(state.config.capacidad) ? 'selected' : ''}>${i}</option>`;
  $('q-capacidad').innerHTML = opCap;
  $('q-linea').value = String(state.config.linea);

  const fams = familiasDisponibles();
  $('q-familia').innerHTML = `<option value="">${fams.length ? '— elige una familia —' : 'Primero cruza jobs en Operaciones'}</option>`
    + fams.map(([f, n]) => `<option value="${esc(f)}" ${f === state.familia ? 'selected' : ''}>${esc(f)} (${nf(n)} filas)</option>`).join('');
  $('q-familia').disabled = fams.length === 0;

  const jobs = new Set(state.planeado.map(r => r.job)).size;
  const desfasado = state.cruceRouters !== null && state.cruceRouters !== rutasKey();
  $('q-info').innerHTML = `Jobs en Planeado: <b>${nf(jobs)}</b> · Línea: <b>${esc(state.config.linea)}</b> · Facilidad: <b>${esc(state.config.capacidad)}</b>`
    + (desfasado ? '<br><span class="warn-txt">Cambiaste los routers: vuelve a cruzar en Operaciones.</span>' : '');
  pintarPreview();
  pintarResumen();
  pintarAuditoria();
  updateLoadInfo();
}

function pintarPreview() {
  const b = $('prev-body');
  const marca = '<div class="t-marca"><span>QORVEX</span> Sequence</div><div class="t-linea"></div>';
  if (!state.familia || !state.resumen || !state.pivot || !state.bloques) {
    b.innerHTML = marca + '<div class="t-vacio">Elige una secuencia disponible para ver la vista previa.</div>';
    return;
  }
  const fila = (k, v) => `<div class="t-fila"><span>${k}</span><b>${esc(v)}</b></div>`;
  b.innerHTML = marca
    + fila('Router', [...state.selected].join(', ') || '—')
    + fila('Facilidad', state.config.capacidad)
    + fila('Línea', `Línea ${state.config.linea}`)
    + fila('Secuencia', state.familia)
    + fila('Jobs', nf(new Set(state.resumen.map(r => r.job)).size))
    + fila('Piezas', nf(state.pivot.total))
    + fila('Esqueletos', state.bloques.length)
    + fila('Etiquetas', state.etiquetas ? state.etiquetas.length : 0)
    + fila('Fecha', new Date().toLocaleString('es-MX'));
}

function pintarResumen() {
  $('res-jobs').textContent = nf(new Set(state.planeado.map(r => r.job)).size);
  $('res-familias').textContent = nf(familiasDisponibles().length);
  $('res-esq').textContent = state.bloques ? nf(state.bloques.length) : '0';
  $('res-etq').textContent = state.etiquetas ? nf(state.etiquetas.length) : '0';
  const base = $('sys-base');
  base.textContent = state.bdata.size ? `Cargada · ${nf(state.bdata.size)}` : 'Falta';
  base.className = 'chip-est ' + (state.bdata.size ? 'bien' : 'pend');
  const cruce = $('sys-cruce');
  const desfasado = state.cruceRouters !== null && state.cruceRouters !== rutasKey();
  const estado = state.cruceRouters === null ? ['Pendiente', 'pend'] : desfasado ? ['Revisar', 'pend'] : ['Listo', 'bien'];
  cruce.textContent = estado[0];
  cruce.className = 'chip-est ' + estado[1];
}

// Cuenta las impresiones del registro de auditoría (acción impresion_pdf) y la última.
async function resumenAuditoria() {
  try {
    const fh = await state.root.getFileHandle('registro_auditoria.jsonl');
    const lineas = (await (await fh.getFile()).text()).split('\n').filter(Boolean);
    let imp = 0, ultima = null;
    for (const l of lineas) {
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o.action === 'impresion_pdf') { imp++; ultima = o.ts; }
    }
    return { imp, ultima };
  } catch { return { imp: 0, ultima: null }; }
}
async function pintarAuditoria() {
  if (!state.root) return;
  const { imp, ultima } = await resumenAuditoria();
  $('res-imp').textContent = nf(imp);
  $('sys-ult').textContent = ultima ? new Date(ultima).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

$('q-restablecer').addEventListener('click', () => {
  state.selected = new Set(state.config.routers || []);
  state.familia = null;
  state.resumen = state.pivot = state.bloques = state.etiquetas = null;
  setStatus($('q-status'), 'Formulario restablecido a la configuración guardada.', 'ok');
  renderInicio();
});
$('q-generar').addEventListener('click', () => {
  if (!state.bloques) return setStatus($('q-status'), 'Elige primero una secuencia disponible.', 'warn');
  imprimirPdf('esq', $('q-status'));
});
$('q-router').addEventListener('change', e => {
  const v = e.target.value;
  if (v === '__varios') return;
  state.selected = new Set(v ? [v] : []);
  renderInicio();
});
$('q-familia').addEventListener('change', () => {
  const f = $('q-familia').value;
  state.familia = f || null;
  if (!f) {
    state.resumen = state.pivot = state.bloques = state.etiquetas = null;
    renderInicio();
    return;
  }
  try {
    armarResumen();
    setStatus($('q-status'), `Secuencia ${f}: ${state.bloques.length} esqueleto(s), ${nf(state.pivot.total)} piezas.`, 'ok');
  } catch (e) {
    state.familia = null;
    state.resumen = state.pivot = state.bloques = state.etiquetas = null;
    setStatus($('q-status'), e.message, 'err');
  }
  renderInicio();
});
$('q-aplicar').addEventListener('click', async () => {
  const cap = Number($('q-capacidad').value);
  if (!(cap >= 1 && cap <= 20)) return setStatus($('q-status'), 'La facilidad debe estar entre 1 y 20.', 'err');
  state.config.capacidad = cap;
  state.config.linea = $('q-linea').value;
  try {
    state.config.routers = [...state.selected];
    await guardarConfig();
    await respaldoAuto();
    if (state.familia) armarResumen();
    await safeLog('configuracion_aplicada', { capacidad: cap, linea: state.config.linea, routers: state.config.routers });
    setStatus($('q-status'), 'Configuración aplicada.' + (state.familia ? ` Secuencia ${state.familia} actualizada.` : ''), 'ok');
  } catch (e) { setStatus($('q-status'), 'No se pudo aplicar: ' + e.message, 'err'); }
  renderInicio();
});

// ---- Resumen, pivot, esqueletos y etiquetas (se arman al elegir la secuencia) ----
function armarResumen() {
  if (!state.familia) throw new Error('Elige una familia.');
  const fam = state.familia;
  state.resumen = buildResumen(state.planeado, fam, state.bdata);
  if (!state.resumen.length) throw new Error(`La familia ${fam} no tiene filas en el Planeado.`);
  state.pivot = buildPivot(state.resumen);
  state.bloques = buildEsqueletoBlocks(state.resumen, state.config.capacidad, state.config.linea, fam);
  state.etiquetas = buildEtiquetas(state.resumen, state.config.capacidad);
  safeLog('resumen_armado', {
    familia: fam, ítems: state.pivot.filas.length, piezas: state.pivot.total,
    esqueletos: state.bloques.length, etiquetas: state.etiquetas.length,
  });
}

// Reportes
function renderReportes() {
  $('rep-cruce').innerHTML = state.cruceRouters === null
    ? 'Aún no hay cruce. Ve a Operaciones, pega los jobs y pulsa "Cruzar jobs con el TXT".'
    : `Routers: <b>${esc(state.cruceRouters.replace(/,/g, ', '))}</b> · Filas en Planeado: <b>${nf(state.planeado.length)}</b> · Jobs no encontrados: <b>${nf(state.noEncontrados.length)}</b>`;
  const piezas = new Map();
  for (const r of state.planeado) piezas.set(r.familia, (piezas.get(r.familia) || 0) + Number(r.qty || 0));
  const fams = familiasDisponibles();
  $('rep-familias').innerHTML = fams.map(([f, n]) => `<tr><td>${esc(f)}</td><td>${nf(n)}</td><td>${nf(piezas.get(f) || 0)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="muted">Sin datos. Haz el cruce primero.</td></tr>';
  $('rep-pivot-info').textContent = state.pivot
    ? `${state.familia} · Línea ${state.config.linea} · ${nf(state.pivot.filas.length)} ítems`
    : 'Elige una Secuencia en Inicio para ver su pivot.';
  $('rep-pivot').innerHTML = state.pivot
    ? state.pivot.filas.map(f => `<tr><td>${esc(f.item)}</td><td>${nf(f.cantidad)}</td></tr>`).join('') + `<tr><th>Grand Total</th><th>${nf(state.pivot.total)}</th></tr>`
    : '';
  $('rep-noenc-card').hidden = state.noEncontrados.length === 0;
  $('rep-noenc').textContent = state.noEncontrados.join(', ');
}

// Esqueletos: vista previa con formato de hoja carta
function htmlPagina(b) {
  const head = `<tr><th class="izq">Router</th><th>Sku</th><th class="izq">Dsc.</th>${b.jobs.map(j => `<th>${esc(j.job)}</th>`).join('')}<th>Total</th></tr>`;
  const ls = `<tr class="ls"><td></td><td></td><td class="izq">LINESET</td>${b.jobs.map(j => `<td>${esc(j.lineset)}</td>`).join('')}<td></td></tr>`;
  const body = b.filas.map(f => `<tr><td class="izq">${esc(f.router)}</td><td>${esc(f.sku)}</td><td class="izq">${esc(f.desc)}</td>`
    + `${f.cantidades.map(c => `<td>${c == null ? '' : nf(c)}</td>`).join('')}<td><b>${nf(f.subtotal)}</b></td></tr>`).join('');
  const sub = `<tr class="total"><td></td><td>Subtotal</td><td></td>${b.subtotales.map(s => `<td>${nf(s)}</td>`).join('')}<td>${nf(b.total)}</td></tr>`;
  const sec = `<tr class="total-2"><td></td><td>Secuencia</td><td></td>${b.secuencia.map(s => `<td>${s}</td>`).join('')}<td></td></tr>`;
  return `<div class="pagina"><div class="pag-head">Página ${b.pagina} · Línea ${esc(b.linea)} · ${esc(b.familia)} · ${b.jobs.length} job(s)</div>`
    + `<div class="table-wrap"><table class="esq"><thead>${head}${ls}</thead><tbody>${body}${sub}${sec}</tbody></table></div></div>`;
}
function renderEsqueletos() {
  const ok = !!state.bloques;
  $('btn-imprimir-esq').disabled = !ok;
  $('btn-vista-esq').disabled = !ok;
  $('btn-vista-pivot').disabled = !ok;
  if (!ok) {
    $('esq-info').textContent = 'Elige una Secuencia en Inicio para ver los esqueletos.';
    $('esq-pivot').innerHTML = '';
    $('esq-preview').innerHTML = '';
    $('pdf-vista').hidden = true;
    return;
  }
  $('esq-info').textContent = `${state.familia} · Línea ${state.config.linea} · Facilidad ${state.config.capacidad} · ${state.bloques.length} esqueleto(s) · ${nf(state.pivot.total)} piezas`;
  $('esq-pivot').innerHTML = state.pivot.filas.map(f => `<tr><td>${esc(f.item)}</td><td>${nf(f.cantidad)}</td></tr>`).join('')
    + `<tr><th>Grand Total</th><th>${nf(state.pivot.total)}</th></tr>`;
  $('esq-preview').innerHTML = state.bloques.map(htmlPagina).join('');
}

// Etiquetas: vista previa (36 por hoja, llenado por columna como el PDF)
function renderEtiquetas() {
  const ok = !!state.etiquetas;
  $('btn-imprimir-etq').disabled = !ok;
  if (!ok) {
    $('etq-info').textContent = 'Elige una Secuencia en Inicio para ver las etiquetas.';
    $('etq-preview').innerHTML = '';
    return;
  }
  const paginas = paginarEtiquetas(state.etiquetas);
  $('etq-info').textContent = `${state.familia} · ${nf(state.etiquetas.length)} etiqueta(s) · consecutivos 1 a ${state.config.capacidad} · ${paginas.length} hoja(s) carta`;
  $('etq-preview').innerHTML = paginas.map((p, i) =>
    `<div class="etq-pagina"><div class="pag-head">Hoja ${i + 1}</div><div class="etq-grid">${p.map(e => `<div class="etq">${esc(e.texto)}</div>`).join('')}</div></div>`).join('');
}

// ---- Impresión PDF ----
async function imprimirPdf(tipo, st) {
  try {
    if (!state.bloques) return setStatus(st, 'Elige una Secuencia en Inicio.', 'warn');
    const meta = { familia: state.familia, linea: state.config.linea, formato: state.config.formato };
    let doc, nombre;
    if (tipo === 'libro') { doc = pdfLibro(state.bloques, state.pivot, meta); nombre = 'Esqueletos y pivot.pdf'; }
    else if (tipo === 'esq') { doc = pdfEsqueletos(state.bloques, meta); nombre = 'Esqueletos.pdf'; }
    else if (tipo === 'pivot') { doc = pdfPivot(state.pivot, meta); nombre = 'Pivot.pdf'; }
    else { doc = pdfEtiquetas(paginarEtiquetas(state.etiquetas)); nombre = 'Etiquetas.pdf'; }
    setStatus(st, 'Generando PDF…', 'warn');
    const ruta = await guardarPdf(state.impDir, state.user, state.familia, nombre, doc);
    imprimirEnDialogo(doc);
    setStatus(st, `Guardado: ${ruta}. Se abrió el diálogo de impresión: elige la impresora y confirma.`, 'ok');
    await safeLog('impresion_pdf', { tipo, familia: state.familia, ruta });
    pintarAuditoria();
  } catch (e) { setStatus(st, 'Error: ' + e.message, 'err'); }
}
// Vista previa dentro de la pantalla (no guarda ni imprime).
function vistaPrevia(tipo) {
  const st = $('esq-status');
  if (!state.bloques) return setStatus(st, 'Elige una Secuencia en Inicio.', 'warn');
  try {
    const meta = { familia: state.familia, linea: state.config.linea, formato: state.config.formato };
    const doc = tipo === 'esq' ? pdfEsqueletos(state.bloques, meta) : pdfPivot(state.pivot, meta);
    const marco = $('pdf-vista');
    marco.src = doc.output('bloburl');
    marco.hidden = false;
    setStatus(st, `Vista previa de ${tipo === 'esq' ? 'esqueletos' : 'pivot'}.`, 'ok');
  } catch (e) { setStatus(st, 'Error: ' + e.message, 'err'); }
}
$('btn-vista-esq').addEventListener('click', () => vistaPrevia('esq'));
$('btn-vista-pivot').addEventListener('click', () => vistaPrevia('pivot'));
// Imprime esqueletos y pivot en el mismo PDF y en el mismo trabajo de impresión.
$('btn-imprimir-esq').addEventListener('click', () => imprimirPdf('libro', $('esq-status')));
$('btn-imprimir-etq').addEventListener('click', () => imprimirPdf('etq', $('etq-status')));

// ---- Configuración: carpetas, respaldos y usuarios ----
async function respaldoAuto() {
  try {
    const r = await respaldar(state.root, state.respaldoDir);
    state.ultimoRespaldo = `${state.respaldoDir.name}/${r.carpeta}`;
    return r;
  } catch (e) { console.warn('Respaldo no creado:', e); return null; }
}
async function elegirCarpeta(clave, modo) {
  const st = $('cfg-status');
  try {
    const dir = await window.showDirectoryPicker({ mode: modo });
    await kvSet(clave, dir);
    return dir;
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(st, 'Error: ' + e.message, 'err');
    return null;
  }
}
// Formato de hoja (Configuración): texto del pie y folio de la empresa.
// Solo actualiza la vista previa (no reescribe los campos mientras se escribe).
function pintarVistaFormato() {
  $('fmt-vista').textContent = textoFormato({ texto: $('fmt-texto').value, folio: $('fmt-folio').value }, new Date());
}
// Carga los campos desde la configuración guardada y luego la vista previa.
function pintarFormato() {
  const f = state.config.formato || DEFAULTS.formato;
  $('fmt-texto').value = f.texto ?? '{mes} ESC';
  $('fmt-folio').value = f.folio || '';
  pintarVistaFormato();
}
$('fmt-texto').addEventListener('input', pintarVistaFormato);
$('fmt-folio').addEventListener('input', pintarVistaFormato);
$('btn-fmt-guardar').addEventListener('click', async () => {
  const st = $('fmt-status');
  try {
    state.config.formato = { texto: $('fmt-texto').value.trim() || '{mes} ESC', folio: $('fmt-folio').value.trim() };
    await guardarConfig();
    pintarFormato();
    setStatus(st, `Formato guardado: ${textoFormato(state.config.formato, new Date())}`, 'ok');
    await safeLog('formato_actualizado', { texto: state.config.formato.texto, folio: state.config.formato.folio });
  } catch (e) { setStatus(st, 'Error: ' + e.message, 'err'); }
});
async function renderConfig() {
  renderRouters();
  pintarFormato();
  $('cfg-root').textContent = state.root ? state.root.name : '—';
  $('cfg-txt').textContent = state.txtDir ? state.txtDir.name : 'No elegida';
  $('cfg-resp').textContent = state.respaldoDir ? state.respaldoDir.name : '—';
  $('cfg-imp').textContent = state.impDir ? state.impDir.name : '—';
  $('usr-sesion').textContent = `Sesión: ${state.nombre} · ${state.rol === 'admin' ? 'Administrador' : 'Operador'}.`;
  $('admin-usuarios').hidden = state.rol !== 'admin';
  if (state.ultimoRespaldo) setStatus($('resp-status'), `Último respaldo: ${state.ultimoRespaldo}`, 'ok');
  const usuarios = await listUsers(state.root).catch(() => []);
  $('usuarios-rows').innerHTML = usuarios.map(u =>
    `<tr><td>${esc(u.name)}</td><td>${esc(u.nombre)}</td><td>${u.rol === 'admin' ? 'Administrador' : 'Operador'}</td></tr>`).join('');
}
$('cfg-change-root').addEventListener('click', async () => {
  const dir = await elegirCarpeta('root', 'readwrite');
  if (!dir) return;
  state.root = dir;
  resetSesion();
  await showLogin();
  setStatus($('folder-status'), 'Carpeta de trabajo cambiada. Inicia sesión en esta carpeta.', 'ok');
});
$('cfg-change-txt').addEventListener('click', async () => {
  const dir = await elegirCarpeta('txt', 'read');
  if (!dir) return;
  state.txtDir = dir; state.txtFiles = [];
  setStatus($('cfg-status'), 'Carpeta de TXT actualizada.', 'ok');
  renderConfig();
});
$('cfg-change-resp').addEventListener('click', async () => {
  const dir = await elegirCarpeta('respaldo', 'readwrite');
  if (!dir) return;
  state.respaldoDir = dir;
  setStatus($('cfg-status'), 'Carpeta de respaldos actualizada.', 'ok');
  renderConfig();
});
$('cfg-change-imp').addEventListener('click', async () => {
  const dir = await elegirCarpeta('impresiones', 'readwrite');
  if (!dir) return;
  state.impDir = dir;
  setStatus($('cfg-status'), 'Carpeta de impresiones actualizada.', 'ok');
  renderConfig();
});
$('btn-respaldar').addEventListener('click', async () => {
  try {
    const r = await respaldar(state.root, state.respaldoDir);
    state.ultimoRespaldo = `${state.respaldoDir.name}/${r.carpeta}`;
    setStatus($('resp-status'), `Respaldo creado: ${state.ultimoRespaldo} (${r.archivos.join(', ')})`, 'ok');
    await safeLog('respaldo_manual', { carpeta: r.carpeta });
  } catch (e) { setStatus($('resp-status'), 'Error: ' + e.message, 'err'); }
});
function soloAdmin() {
  if (state.rol !== 'admin') throw new Error('Solo el administrador puede hacer esto.');
}
$('btn-alta').addEventListener('click', async () => {
  const st = $('usr-status');
  try {
    soloAdmin();
    const u = await createUser(state.root, $('alta-empleado').value, $('alta-pass').value, $('alta-nombre').value, $('alta-rol').value);
    $('alta-empleado').value = ''; $('alta-nombre').value = ''; $('alta-pass').value = '';
    await safeLog('usuario_alta', { usuario: u.name, rol: u.rol });
    await respaldoAuto();
    setStatus(st, `Usuario ${u.name} dado de alta (${u.rol === 'admin' ? 'Administrador' : 'Operador'}).`, 'ok');
    renderConfig();
  } catch (e) { setStatus(st, e.message, 'err'); }
});
$('btn-rst').addEventListener('click', async () => {
  const st = $('usr-status');
  try {
    soloAdmin();
    const nombreUsuario = await resetPassword(state.root, $('rst-empleado').value, $('rst-pass').value);
    $('rst-empleado').value = ''; $('rst-pass').value = '';
    await safeLog('contrasena_restablecida', { usuario: nombreUsuario });
    await respaldoAuto();
    setStatus(st, `Contraseña de ${nombreUsuario} restablecida.`, 'ok');
  } catch (e) { setStatus(st, e.message, 'err'); }
});

init();
