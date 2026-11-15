import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { renderRoute } from './content.js';
import { ICONS } from './icon.js';
import { robotsTxt, sitemapXml } from './crawl.js';
import { llmsTxt } from './llms.js';
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
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
};

const inbox = new Map();

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
    // a stand-in for deploy/inbox.mjs: conversations live in memory, erin answers each message a
    // few seconds later, and there are no push notifications
    if (url.pathname === '/api/message/push') return send(404);
    if (url.pathname === '/api/message') {
      const key = req.headers.cookie?.match(/(?:^|;\s*)inbox=([\w-]+)/)?.[1];
      const view = (k) => JSON.stringify({ conversations: [...(inbox.get(k) ?? [])].reverse(), push: null });
      if (req.method === 'GET') return send(200, view(key), TYPES['.json']);
      if (req.method !== 'POST') return send(405);
      const { message, website, convo } = await readJson(req, url);
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) return send(400);
      if (website) return send(204);
      console.log(`\n[message, not saved in dev]\n${message.trim()}`);
      const fresh = key ?? randomUUID();
      if (!inbox.has(fresh)) inbox.set(fresh, []);
      const mine = inbox.get(fresh);
      const into = convo ? mine.find((c) => c.id === convo) : { id: randomUUID(), entries: [] };
      if (!into) return send(404);
      if (!convo) mine.push(into);
      into.entries.push({ from: 'you', time: new Date().toISOString(), text: message.trim() });
      setTimeout(() => into.entries.push({ from: 'erin', time: new Date().toISOString(), text: 'a pretend reply from the dev server' }), 5000);
      res.setHeader('Set-Cookie', `inbox=${fresh}; Path=/api/message; HttpOnly; SameSite=Strict`);
      return send(200, view(fresh), TYPES['.json']);
    }
    if (req.method !== 'GET') return send(405);

    const tune = url.searchParams.has('tune');
    const page = await renderRoute(url.pathname);
    const render = async (html) => renderPage(html, await loadSettings(), { tune, presets: await loadPresets() });
    if (page) return send(200, await render(page), TYPES['.html']);
    if (url.pathname === '/api/log/stream') {
      const stop = new AbortController();
      req.on('close', () => stop.abort());
      const live = await fetch('https://errr.in/api/log/stream', { signal: stop.signal }).catch(() => null);
      if (!live?.ok || !live.headers.get('content-type')?.startsWith('text/event-stream')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        return res.end(`retry: 60000
data: ${JSON.stringify(JSON.parse(await readFile(resolve('dev/log-sample.json'), 'utf8')))}\n\n`);
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      try {
        for await (const chunk of live.body) res.write(chunk);
      } catch {}
      return res.end();
    }
    if (url.pathname === '/log.xml') {
      const live = await fetch('https://errr.in/log.xml', { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (live?.ok) return send(200, await live.text(), 'application/rss+xml; charset=utf-8');
      return send(404, 'the feed comes from the log bot; the dev server can only pass on the live one');
    }
    if (url.pathname === '/api/log' || url.pathname.startsWith('/api/log/media/')) {
      const live = await fetch(`https://errr.in${url.pathname}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      const type = live?.ok ? live.headers.get('content-type') ?? '' : '';
      if (/^(application\/json|image\/)/.test(type)) return send(200, Buffer.from(await live.arrayBuffer()), type);
      if (url.pathname === '/api/log') return send(200, await readFile(resolve('dev/log-sample.json')), TYPES['.json']);
      return send(404, 'not found');
    }
    if (url.pathname === '/robots.txt') return send(200, robotsTxt(), 'text/plain; charset=utf-8');
    if (url.pathname === '/sitemap.xml') return send(200, await sitemapXml(), 'application/xml; charset=utf-8');
    if (url.pathname === '/llms.txt') return send(200, await llmsTxt(), 'text/plain; charset=utf-8');
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
    // safari only plays video from servers that answer byte ranges
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, content.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), content.length - 1) : content.length - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      return res.end(content.subarray(start, end + 1));
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
