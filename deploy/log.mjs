import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = process.env.DISCORD_API ?? 'https://discord.com/api/v10';
const GATEWAY = process.env.DISCORD_GATEWAY ?? 'wss://gateway.discord.gg/?v=10&encoding=json';
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
const FATAL = [4004, 4010, 4011, 4012, 4013, 4014];
const INTENTS = (1 << 9) | (1 << 15);
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const SERVED = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

let feed = JSON.stringify({ updated: null, entries: [] });
const listeners = new Set();
const visitors = new Map();

const log = (...parts) => console.error(new Date().toISOString(), ...parts);

const discord = (path) => fetch(`${API}${path}`, {
  headers: { Authorization: `Bot ${TOKEN}`, 'User-Agent': 'DiscordBot (https://errr.in, 1)' },
  signal: AbortSignal.timeout(15_000),
});

function plain(message) {
  const users = new Map((message.mentions ?? []).map((u) => [u.id, u.global_name ?? u.username]));
  return (message.content ?? '')
    .replace(/<@!?(\d+)>/g, (_, id) => `@${users.get(id) ?? 'someone'}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(Number(s) * 1000).toISOString().slice(0, 16).replace('T', ' '))
    .trim();
}

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
let backoff = 5000;
function connect() {
  const socket = new WebSocket(GATEWAY);
  let beat = null, first = null, steady = null, seq = null, acked = true, pause = 0;
  const send = (data) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(data));
  const heartbeat = () => {
    if (!acked) return socket.close(4000, 'no heartbeat ack');
    acked = false;
    send({ op: 1, d: seq });
  };
  socket.addEventListener('message', ({ data }) => {
    let packet;
    try {
      packet = JSON.parse(data);
    } catch {
      return;
    }
    const { op, d, s, t } = packet;
    if (s !== null && s !== undefined) seq = s;
    if (op === 10) {
      clearInterval(beat);
      clearTimeout(first);
      first = setTimeout(() => {
        heartbeat();
        beat = setInterval(heartbeat, d.heartbeat_interval);
      }, d.heartbeat_interval * Math.random());
      send({ op: 2, d: { token: TOKEN, intents: INTENTS, properties: { os: 'linux', browser: 'errr.in', device: 'errr.in' } } });
    } else if (op === 11) {
      acked = true;
    } else if (op === 1) {
      send({ op: 1, d: seq });
    } else if (op === 7) {
      socket.close(4000, 'reconnect');
    } else if (op === 9) {
      pause = 1000 + 4000 * Math.random();
      socket.close(4000, 'invalid session');
    } else if (op === 0 && t === 'READY') {
      steady = setTimeout(() => { backoff = 5000; }, 60_000);
      log('connected to the gateway');
      refresh();
    } else if (op === 0 && WATCHED.has(t) && d?.channel_id === CHANNEL) {
      refresh();
    }
  });
  socket.addEventListener('close', ({ code }) => {
    clearInterval(beat);
    clearTimeout(first);
    clearTimeout(steady);
    if (FATAL.includes(code)) return log(`gateway refused the bot (${code}); check the token and the message content intent`);
    const delay = Math.max(backoff, pause);
    log(`gateway closed (${code}), reconnecting in ${Math.round(delay / 1000)}s`);
    setTimeout(connect, delay);
    backoff = Math.min(backoff * 2, 300_000);
  });
  socket.addEventListener('error', () => {});
}

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
  connect();
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
