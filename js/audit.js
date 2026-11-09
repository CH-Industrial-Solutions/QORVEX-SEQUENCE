// Registro de auditoría: cada acción queda en registro_auditoria.jsonl de la carpeta de trabajo.
export async function logAction(dirHandle, user, action, detail = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), user, action, ...detail }) + '\n';
  const fh = await dirHandle.getFileHandle('registro_auditoria.jsonl', { create: true });
  const w = await fh.createWritable({ keepExistingData: true });
  const file = await fh.getFile();
  await w.seek(file.size);
  await w.write(line);
  await w.close();
}
