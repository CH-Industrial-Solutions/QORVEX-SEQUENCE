import fs from 'node:fs';
import { scanTxt, normalizeJob, parseLine } from '../js/txt-source.js';
const SRC = '/mnt/user-data/uploads/Planned_Trans_011.txt';
console.log(parseLine('4065598C2@1@Z36@083521'), normalizeJob('2-520202'), normalizeJob('083521'));
const t0 = Date.now();
const sel = { routers: new Set(['Z36']) };
let rows = 0; const jobs = new Set();
const stats = await scanTxt(fs.createReadStream(SRC, { highWaterMark: 1 << 20 }), sel, 'Planned_Trans_011.txt', r => { rows++; if (r.jobKey) jobs.add(r.jobKey); });
console.log('stats', stats, 'jobs', jobs.size, 'ms', Date.now() - t0);
// Prueba de selección por job concreto
const pick = new Set(['164189', '520202']);
const s2 = await scanTxt(fs.createReadStream(SRC, { highWaterMark: 1 << 20 }), { routers: new Set(['ZW0', 'DIR']), jobs: pick }, 'x', r => {});
console.log('job filter stats', s2, 'ms', Date.now() - t0);
