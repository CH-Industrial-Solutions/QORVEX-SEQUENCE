// Verifica que la página carga sin errores de JavaScript (no prueba File System Access).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', process.env.HOME + '/node_modules'].concat((process.env.NODE_PATH||'').split(':')) }));
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const server = http.createServer((req, res) => {
  const p = path.join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const type = p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.png') ? 'image/png' : 'text/html';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(p).pipe(res);
}).listen(8765);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8765/');
await page.waitForTimeout(500);
const title = await page.title();
const logo = await page.evaluate(() => getComputedStyle(document.querySelector('header img')).height);
await page.screenshot({ path: path.join(root, 'tests', 'preview.png'), fullPage: true });
console.log({ title, logo, errors });
await browser.close(); server.close();
