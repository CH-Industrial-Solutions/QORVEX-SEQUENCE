// Usuarios locales de la carpeta de trabajo (estilo QORVEX MOVIL).
// Archivo: usuarios.json en la carpeta de trabajo. Contraseñas guardadas como
// PBKDF2-SHA256 con sal aleatoria; nunca en texto plano ni en el repositorio.
// Sirve para saber quién hizo cada cambio (registro de auditoría); no es un control de acceso fuerte.

const ITER = 210000;
const enc = new TextEncoder();

function toHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(hex) { return Uint8Array.from(hex.match(/../g).map(h => parseInt(h, 16))); }

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  return { salt: toHex(salt), hash: toHex(bits), iterations: ITER };
}

export async function verifyPassword(password, record) {
  const { hash } = await hashPassword(password, record.salt);
  return hash === record.hash;
}

async function readUsers(dirHandle) {
  try {
    const fh = await dirHandle.getFileHandle('usuarios.json');
    const data = JSON.parse(await (await fh.getFile()).text());
    return data.users || [];
  } catch (e) {
    if (e.name === 'NotFoundError') return [];
    throw e;
  }
}

async function writeUsers(dirHandle, users) {
  const fh = await dirHandle.getFileHandle('usuarios.json', { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify({ users }, null, 2));
  await w.close();
}

// El primer usuario siempre es administrador; si un registro antiguo no tiene rol, el primero es admin.
function rolDe(users, rec) {
  if (rec.rol) return rec.rol;
  return users[0] === rec ? 'admin' : 'operador';
}

// Devuelve { mode: 'create' | 'login', users } para saber qué pantalla mostrar.
export async function accountMode(dirHandle) {
  const users = await readUsers(dirHandle);
  return { mode: users.length === 0 ? 'create' : 'login', users };
}

// Lista para la pantalla de Configuración (sin contraseñas).
export async function listUsers(dirHandle) {
  const users = await readUsers(dirHandle);
  return users.map(u => ({ name: u.name, nombre: u.nombre || u.name, rol: rolDe(users, u), created: u.created || '' }));
}

export async function createUser(dirHandle, username, password, nombre, rol = 'operador') {
  const name = username.trim();
  if (!name) throw new Error('Escribe el No. de empleado.');
  if (password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  const users = await readUsers(dirHandle);
  if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new Error('Ese usuario ya existe.');
  const rolFinal = users.length === 0 ? 'admin' : (rol === 'admin' ? 'admin' : 'operador');
  const rec = await hashPassword(password);
  users.push({ name, nombre: (nombre || name).trim(), rol: rolFinal, ...rec, created: new Date().toISOString() });
  await writeUsers(dirHandle, users);
  return { name, nombre: (nombre || name).trim(), rol: rolFinal };
}

export async function resetPassword(dirHandle, username, password) {
  if (password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  const users = await readUsers(dirHandle);
  const rec = users.find(u => u.name.toLowerCase() === username.trim().toLowerCase());
  if (!rec) throw new Error('Ese No. de empleado no existe.');
  Object.assign(rec, await hashPassword(password));
  await writeUsers(dirHandle, users);
  return rec.name;
}

export async function login(dirHandle, username, password) {
  const users = await readUsers(dirHandle);
  const rec = users.find(u => u.name.toLowerCase() === username.trim().toLowerCase());
  if (!rec) throw new Error('Usuario no encontrado. Revisa el número o pide al administrador que te dé de alta.');
  if (!(await verifyPassword(password, rec))) throw new Error('Contraseña incorrecta.');
  return { name: rec.name, nombre: rec.nombre || rec.name, rol: rolDe(users, rec) };
}
