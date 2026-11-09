// Lectura y escritura de archivos JSON dentro de la carpeta de trabajo (configuración, usuarios, etc.).
export async function readJson(dir, name, fallback) {
  try {
    const fh = await dir.getFileHandle(name);
    return JSON.parse(await (await fh.getFile()).text());
  } catch (e) {
    if (e.name === 'NotFoundError') return fallback;
    throw e;
  }
}

export async function writeJson(dir, name, obj) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(obj, null, 2));
  await w.close();
}

// Copia un archivo de texto de una carpeta a otra. Devuelve false si el origen no existe.
export async function copiarArchivo(origen, nombre, destino) {
  let texto;
  try {
    texto = await (await (await origen.getFileHandle(nombre)).getFile()).text();
  } catch (e) {
    if (e.name === 'NotFoundError') return false;
    throw e;
  }
  const w = await (await destino.getFileHandle(nombre, { create: true })).createWritable();
  await w.write(texto);
  await w.close();
  return true;
}

// Respaldo: crea respaldos/AAAA-MM-DD_HHMMSS con usuarios, configuración y registro de auditoría.
const ARCHIVOS_RESPALDO = ['usuarios.json', 'configuracion.json', 'registro_auditoria.jsonl'];
export async function respaldar(root, respaldoDir) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const carpeta = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const dir = await respaldoDir.getDirectoryHandle(carpeta, { create: true });
  const archivos = [];
  for (const nombre of ARCHIVOS_RESPALDO) {
    if (await copiarArchivo(root, nombre, dir)) archivos.push(nombre);
  }
  return { carpeta, archivos };
}
