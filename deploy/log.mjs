import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GUILD_MESSAGES, MESSAGE_CONTENT, connect, discord as ask, log, plain } from './discord.mjs';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL = process.env.DISCORD_LOG_CHANNEL;
const AUTHOR = process.env.DISCORD_LOG_AUTHOR;
const DATA = process.env.LOG_DATA ?? '/data';
const MEDIA = join(DATA, 'media');
const FEED = join(DATA, 'log.json');
const KEEP = 15;
const EVERY_MS = 60_000;
const MAX_IMAGE = 8_000_000;
const MAX_LISTENERS = 500;
const PER_VISITOR = 4;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const SERVED = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

let feed = JSON.stringify({ updated: null, entries: [] });
const listeners = new Set();
const visitors = new Map();

const discord = (path) => ask(TOKEN, path);

async function saveImage(attachment) {
  const ext = IMAGE_TYPES[attachment.content_type?.split(';')[0]];
  if (!ext || attachment.size > MAX_IMAGE) return null;
  const name = `${attachment.id}.${ext}`;
  const path = join(MEDIA, name);
  const have = await stat(path).then(() => true, () => false);
  if (!have) {
    const res = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE) return null;
    await writeFile(`${path}.part`, bytes);
    await rename(`${path}.part`, path);
  }
  return { name, src: `/api/log/media/${name}`, width: attachment.width ?? null, height: attachment.height ?? null };
}

function announce() {
  for (const res of listeners) res.write(`data: ${feed}\n\n`);
}

async function rebuild() {
  const res = await discord(`/channels/${CHANNEL}/messages?limit=100`);
  if (res.status === 429) {
    const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 5);
    throw Object.assign(new Error('rate limited'), { wait: wait * 1000 });
  }
  if (!res.ok) throw new Error(`discord answered ${res.status}`);
  const messages = (await res.json()).filter((m) => m.author?.id === AUTHOR && (m.type === 0 || m.type === 19));
  const entries = [];
  const keep = new Set();
  for (const message of messages) {
    if (entries.length >= KEEP) break;
    const body = message.message_snapshots?.[0]?.message ?? message;
    const images = [];
    for (const attachment of body.attachments ?? []) {
      const image = await saveImage(attachment).catch(() => null);
      if (image) {
        keep.add(image.name);
        images.push({ src: image.src, width: image.width, height: image.height });
      }
    }
    const text = plain(body);
    if (!text && !images.length) continue;
    entries.push({ id: message.id, time: message.timestamp, edited: message.edited_timestamp ?? null, text, images });
  }
  const changed = JSON.stringify(entries) !== shown;
  shown = JSON.stringify(entries);
  feed = JSON.stringify({ updated: new Date().toISOString(), entries });
  if (changed) announce();
  await writeFile(`${FEED}.part`, feed);
  await rename(`${FEED}.part`, FEED);
  for (const file of await readdir(MEDIA)) if (!keep.has(file)) await rm(join(MEDIA, file), { force: true });
}

let shown = '[]';
let running = false, again = false, timer = null, notBefore = 0;
function refresh() {
  if (running) return void (again = true);
  clearTimeout(timer);
  const wait = notBefore - Date.now();
  if (wait > 0) return void (timer = setTimeout(refresh, wait));
  running = true;
  rebuild().catch((err) => {
    log(err.message);
    if (err.wait) notBefore = Date.now() + err.wait;
  }).finally(() => {
    running = false;
    const soon = again;
    again = false;
    if (soon) refresh();
    else timer = setTimeout(refresh, Math.max(EVERY_MS, notBefore - Date.now()));
  });
}

const WATCHED = new Set(['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'MESSAGE_DELETE_BULK']);

await mkdir(MEDIA, { recursive: true });
try {
  const saved = JSON.parse(await readFile(FEED, 'utf8'));
  if (Array.isArray(saved.entries)) {
    feed = JSON.stringify(saved);
    shown = JSON.stringify(saved.entries);
  }
} catch {}
if (TOKEN && CHANNEL && AUTHOR) {
  refresh();
  connect({
    token: TOKEN,
    intents: GUILD_MESSAGES | MESSAGE_CONTENT,
    onReady: refresh,
    onEvent: (type, d) => { if (WATCHED.has(type) && d?.channel_id === CHANNEL) refresh(); },
  });
} else {
  log('DISCORD_BOT_TOKEN, DISCORD_LOG_CHANNEL and DISCORD_LOG_AUTHOR are needed; serving the saved log only');
}

setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25_000);

createServer((req, res) => answer(req, res).catch(() => {
  if (!res.headersSent) res.writeHead(400);
  res.end();
})).listen(8080);

async function answer(req, res) {
  const url = new URL(req.url, 'http://log');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  if (url.pathname === '/api/log') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(req.method === 'HEAD' ? undefined : feed);
  }
  if (url.pathname === '/api/log/stream') {
    const who = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress);
    if (listeners.size >= MAX_LISTENERS || (visitors.get(who) ?? 0) >= PER_VISITOR) return res.writeHead(503).end();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    if (req.method === 'HEAD') return res.end();
    res.write(`retry: 5000\ndata: ${feed}\n\n`);
    listeners.add(res);
    visitors.set(who, (visitors.get(who) ?? 0) + 1);
    res.on('close', () => {
      listeners.delete(res);
      const left = (visitors.get(who) ?? 1) - 1;
      if (left > 0) visitors.set(who, left);
      else visitors.delete(who);
    });
    return;
  }
  const file = url.pathname.match(/^\/api\/log\/media\/(\d+\.(png|jpg|gif|webp))$/);
  if (!file) return res.writeHead(404).end();
  const bytes = await readFile(join(MEDIA, file[1])).catch(() => null);
  if (!bytes) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': SERVED[file[2]], 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
