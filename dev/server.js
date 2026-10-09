import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { renderRoute } from './content.js';
import { ICONS } from './icon.js';
import { deletePreset, loadPresets, savePreset } from './presets.js';
import { renderPage } from './render.js';
import { formatSettings, validate } from './tune/settings.js';

const PORT = Number(process.env.PORT ?? 5173);
const LAN = process.argv.includes('--lan');
const SITE = resolve('site');
const TUNE = resolve('dev/tune');
const SETTINGS = resolve('settings.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
};

const loadSettings = async () => validate(JSON.parse(await readFile(SETTINGS, 'utf8')));
const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function readJson(req, url) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('expected JSON'), { status: 415 });
  if (req.headers.origin && req.headers.origin !== url.origin) throw Object.assign(new Error('wrong origin'), { status: 403 });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw Object.assign(new Error('too large'), { status: 413 });
  }
  return JSON.parse(body);
}

createServer(async (req, res) => {
  const send = (status, body = '', type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/__tune/settings') {
      if (req.method === 'GET') return send(200, JSON.stringify(await loadSettings()), TYPES['.json']);
      if (req.method === 'POST') {
        if (!isLoopback(req)) return send(403, 'saving only works from this computer');
        const settings = validate(await readJson(req, url));
        await writeFile(SETTINGS, formatSettings(settings));
        return send(200, JSON.stringify(settings), TYPES['.json']);
      }
      return send(405);
    }

    if (url.pathname === '/__tune/presets' || url.pathname.startsWith('/__tune/presets/')) {
      if (req.method !== 'GET') {
        if (!isLoopback(req)) return send(403, 'saving only works from this computer');
        if (req.method === 'POST' && url.pathname === '/__tune/presets') {
          const { name, settings } = await readJson(req, url);
          await savePreset(name, settings);
        } else if (req.method === 'DELETE') {
          if (req.headers.origin && req.headers.origin !== url.origin) return send(403, 'wrong origin');
          await deletePreset(decodeURIComponent(url.pathname.slice('/__tune/presets/'.length)));
        } else {
          return send(405);
        }
      }
      return send(200, JSON.stringify(await loadPresets()), TYPES['.json']);
    }

    if (url.pathname === '/__tune/log' && req.method === 'POST') {
      console.log(`\n[perf] from ${req.socket.remoteAddress}\n${JSON.stringify(await readJson(req, url), null, 2)}`);
      return send(204);
    }
    if (req.method !== 'GET') return send(405);

    const tune = url.searchParams.has('tune');
    const page = await renderRoute(url.pathname);
    const render = async (html) => renderPage(html, await loadSettings(), { tune, presets: await loadPresets() });
    if (page) return send(200, await render(page), TYPES['.html']);
    if (ICONS[url.pathname]) return send(200, ICONS[url.pathname]((await loadSettings()).palette), TYPES['.png']);
    if (url.pathname === '/writeup.html') return send(404, 'not found');

    const [base, rest] = url.pathname.startsWith('/__tune/')
      ? [TUNE, url.pathname.slice('/__tune'.length)]
      : [SITE, url.pathname];
    let file = resolve(base, '.' + decodeURIComponent(rest));
    if (file !== base && !file.startsWith(base + sep)) return send(403);
    if ((await stat(file).catch(() => null))?.isDirectory()) file = resolve(file, 'index.html');

    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const content = await readFile(file).catch(() => null);
    if (!content) return send(404, await render(await renderRoute('/404.html')), TYPES['.html']);
    if (extname(file) === '.html') {
      return send(200, await render(content.toString()), type);
    }
    return send(200, content, type);
  } catch (err) {
    send(err.status ?? 400, String(err.message ?? err));
  }
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`http://localhost:${PORT}/?tune   site + tuning panel`);
  if (!LAN) return;
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`http://${a.address}:${PORT}/?tune   (other devices; saving disabled)`);
    }
  }
});
