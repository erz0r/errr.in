import { createServer } from 'node:http';
import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { appendFile, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GUILD_MESSAGES, MESSAGE_CONTENT, connect, discord, log, plain } from './discord.mjs';

const DATA = process.env.INBOX_DATA ?? '/data';
const MESSAGES = join(DATA, 'messages.jsonl');
const REPLIES = join(DATA, 'replies.jsonl');
const PUSH = join(DATA, 'push.json');
const VAPID = join(DATA, 'vapid.json');
const MAX_FILE = 5_000_000;
const MAX_LENGTH = 2000;
const WEBHOOK = process.env.DISCORD_WEBHOOK;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const ERIN = process.env.DISCORD_LOG_AUTHOR;
const YEAR = 365 * 24 * 60 * 60;
const SEEN = '📨';
const CATCH_UP_DAYS = 14;
// push subscriptions are urls the server will post to, so only the browsers' own push services
// (INBOX_PUSH_HOSTS swaps the list for tests, which run a push service on plain http)
const PUSH_HOSTS = new RegExp(process.env.INBOX_PUSH_HOSTS ?? '(^|\\.)(fcm\\.googleapis\\.com|push\\.services\\.mozilla\\.com|push\\.apple\\.com|notify\\.windows\\.com)$');
const PUSH_PROTOCOLS = process.env.INBOX_PUSH_HOSTS ? ['https:', 'http:'] : ['https:'];

// a visitor's browser keeps a random key in an http-only cookie. the server only stores a hash of
// it, so the files on disk can't be used to read anyone's replies. each message a visitor starts
// is its own conversation, which on discord is a thread under the webhook's post.
const convos = new Map(); // id -> { id, visitor, discordThread, entries: [{ from, time, text, discord, edited? }] }
const visitors = new Map(); // visitor -> [convo]
const posts = new Map(); // discord message id -> { convo, entry }
const threads = new Map(); // discord thread id -> convo
let pushes = {}; // visitor -> [subscription]
let vapid = null;
let channel = null;

const hash = (key) => createHash('sha256').update(key).digest('hex').slice(0, 32);
const tag = (visitor) => visitor.slice(0, 6);
const keyOf = (req) => req.headers.cookie?.match(/(?:^|;\s*)inbox=([A-Za-z0-9_-]{32})(?:;|$)/)?.[1] ?? null;
const cookie = (key) => `inbox=${key}; Path=/api/message; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Strict`;
const lastTime = (c) => c.entries.at(-1)?.time ?? '';
const tooBig = async (file) => ((await stat(file).catch(() => null))?.size ?? 0) > MAX_FILE;
const writeJson = async (file, data) => { await writeFile(`${file}.part`, JSON.stringify(data)); await rename(`${file}.part`, file); };

function view(visitor) {
  return (visitors.get(visitor) ?? []).filter((c) => c.entries.length).sort((a, b) => lastTime(b).localeCompare(lastTime(a))).map((c) => ({
    id: c.id,
    entries: c.entries.map(({ from, time, text, edited }) => ({ from, time, text, ...(edited && { edited }) })),
  }));
}

function convoFor(id, visitor) {
  if (!convos.has(id)) {
    const convo = { id, visitor, discordThread: null, entries: [] };
    convos.set(id, convo);
    if (!visitors.has(visitor)) visitors.set(visitor, []);
    visitors.get(visitor).push(convo);
  }
  return convos.get(id);
}

function remember(convo, entry) {
  // in time order, since loading reads visitors' messages and erin's answers from separate files
  const at = convo.entries.findLastIndex((e) => e.time <= entry.time) + 1;
  convo.entries.splice(at, 0, entry);
  if (entry.discord) posts.set(entry.discord, { convo, entry });
}

function bind(convo, discordThread) {
  if (!discordThread) return;
  convo.discordThread = discordThread;
  threads.set(discordThread, convo);
}

function forget(id) {
  const post = posts.get(id);
  if (!post) return;
  post.convo.entries.splice(post.convo.entries.indexOf(post.entry), 1);
  posts.delete(id);
}

async function load() {
  const lines = async (file) => (await readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  // messages from before conversations existed have no visitor, so they stay on discord only
  for (const m of await lines(MESSAGES)) {
    if (!m.visitor || !m.convo) continue;
    const convo = convoFor(m.convo, m.visitor);
    bind(convo, m.discordThread);
    remember(convo, { from: 'you', time: m.time, text: m.message, discord: m.discord });
  }
  for (const r of await lines(REPLIES)) {
    if (r.deleted) forget(r.discord);
    else if (r.edited && posts.has(r.discord)) Object.assign(posts.get(r.discord).entry, { text: r.reply, edited: r.edited });
    else if (convos.has(r.convo) && !posts.has(r.discord)) remember(convos.get(r.convo), { from: 'erin', time: r.time, text: r.reply, discord: r.discord });
  }
  try {
    pushes = JSON.parse(await readFile(PUSH, 'utf8'));
  } catch {}
  try {
    vapid = JSON.parse(await readFile(VAPID, 'utf8'));
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    vapid = { public: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url'), private: privateKey.export({ format: 'jwk' }) };
    await writeJson(VAPID, vapid);
  }
  vapid.key = createPrivateKey({ key: vapid.private, format: 'jwk' });
}

// ---- discord: visitor messages go out through the webhook, erin's answers come back through the bot

async function webhook(body, thread) {
  if (!WEBHOOK) return null;
  try {
    const url = new URL(WEBHOOK);
    url.searchParams.set('wait', 'true');
    if (thread) url.searchParams.set('thread_id', thread);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...body }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const posted = await res.json();
    if (!thread) channel ??= posted.channel_id;
    return posted.id;
  } catch {
    return null;
  }
}

async function startThread(convo, starter, message) {
  if (!TOKEN || !channel) return;
  try {
    const name = `${tag(convo.visitor)} · ${message.replace(/\s+/g, ' ')}`.slice(0, 90);
    const res = await discord(TOKEN, `/channels/${channel}/messages/${starter}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, auto_archive_duration: 10080 }),
    });
    if (!res.ok) return log(`discord answered ${res.status} starting a thread`);
    bind(convo, (await res.json()).id);
    // so follow-ups in the thread notify erin even before erin has said anything in it
    if (ERIN) discord(TOKEN, `/channels/${convo.discordThread}/thread-members/${ERIN}`, { method: 'PUT' }).catch(() => {});
  } catch (err) {
    log(`starting a thread failed: ${err.message}`);
  }
}

async function post(convo, message, time) {
  const first = !convo.entries.length;
  if (!first && convo.discordThread) {
    const id = await webhook({ username: `anon ${tag(convo.visitor)}`, content: message }, convo.discordThread);
    if (id) return id;
  }
  const opening = convo.entries[0]?.text.replace(/\s+/g, ' ').slice(0, 60);
  const id = await webhook({
    username: 'errr.in',
    embeds: [{
      title: first ? 'someone told you something' : 'more from someone',
      description: message,
      timestamp: time,
      footer: { text: first ? `${tag(convo.visitor)}` : `${tag(convo.visitor)} · about "${opening}" · reply to this to answer them` },
    }],
  });
  if (id && first) await startThread(convo, id, message);
  return id;
}

// erin answers by talking in a conversation's thread, or by using discord's reply on any of its
// messages (for when a thread couldn't be made). the bot reacts so erin knows it went through.
function take(message) {
  if (!ERIN || message.author?.id !== ERIN || posts.has(message.id) || ![0, 19].includes(message.type)) return;
  const convo = threads.get(message.channel_id) ?? posts.get(message.message_reference?.message_id)?.convo;
  const text = plain(message).slice(0, MAX_LENGTH);
  if (!convo || !text) return;
  const time = message.timestamp ?? new Date().toISOString();
  remember(convo, { from: 'erin', time, text, discord: message.id });
  appendFile(REPLIES, JSON.stringify({ time, reply: text, convo: convo.id, discord: message.id }) + '\n').catch((err) => log(`saving a reply failed: ${err.message}`));
  discord(TOKEN, `/channels/${message.channel_id}/messages/${message.id}/reactions/${encodeURIComponent(SEEN)}/@me`, { method: 'PUT' }).catch(() => {});
  notify(convo.visitor);
}

async function edit(message) {
  const post = posts.get(message.id);
  if (post?.entry.from !== 'erin' || typeof message.content !== 'string') return;
  const text = plain(message).slice(0, MAX_LENGTH);
  if (!text || text === post.entry.text) return;
  const edited = message.edited_timestamp ?? new Date().toISOString();
  Object.assign(post.entry, { text, edited });
  await appendFile(REPLIES, JSON.stringify({ discord: message.id, edited, reply: text }) + '\n');
}

async function remove(id) {
  if (posts.get(id)?.entry.from !== 'erin') return;
  forget(id);
  await appendFile(REPLIES, JSON.stringify({ discord: id, deleted: new Date().toISOString() }) + '\n');
}

// answers and edits made while the bot was away, from the channel and recently active threads
async function catchUp() {
  try {
    if (!channel && WEBHOOK) channel = (await (await fetch(WEBHOOK, { signal: AbortSignal.timeout(15_000) })).json()).channel_id;
    const since = new Date(Date.now() - CATCH_UP_DAYS * 86_400_000).toISOString();
    const places = [channel, ...[...threads.values()].filter((c) => lastTime(c) > since).map((c) => c.discordThread)].filter(Boolean);
    for (const place of places) {
      const res = await discord(TOKEN, `/channels/${place}/messages?limit=100`);
      if (!res.ok) {
        log(`discord answered ${res.status} reading ${place === channel ? 'the inbox channel' : 'a thread'}`);
        continue;
      }
      for (const message of (await res.json()).reverse()) {
        if (posts.has(message.id)) await edit(message);
        else take(message);
      }
    }
  } catch (err) {
    log(`catching up failed: ${err.message}`);
  }
}

// ---- web push. the push carries no payload (so nothing needs encrypting); the page's service
// worker asks /api/message what's new when it wakes up.

function vapidAuth(endpoint) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://errr.in' };
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part(claims)}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: vapid.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${signature}, k=${vapid.public}`;
}

async function notify(visitor) {
  const subs = pushes[visitor] ?? [];
  if (!subs.length) return;
  const gone = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: { Authorization: vapidAuth(sub.endpoint), TTL: String(7 * 86_400), Urgency: 'normal', Topic: 'reply' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) gone.push(sub.endpoint);
      else if (!res.ok) log(`push service answered ${res.status}`);
    } catch (err) {
      log(`push failed: ${err.message}`);
    }
  }));
  if (gone.length) {
    pushes[visitor] = (pushes[visitor] ?? []).filter((s) => !gone.includes(s.endpoint));
    await writeJson(PUSH, pushes).catch(() => {});
  }
}

function validSubscription(sub) {
  try {
    const url = new URL(sub.endpoint);
    return PUSH_PROTOCOLS.includes(url.protocol) && PUSH_HOSTS.test(url.hostname) && sub.endpoint.length < 1000;
  } catch {
    return false;
  }
}

// ---- http

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('expected json'), { status: 415 });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8000) throw Object.assign(new Error('too large'), { status: 413 });
  }
  return JSON.parse(body);
}

await load();
if (TOKEN && ERIN) {
  connect({
    token: TOKEN,
    intents: GUILD_MESSAGES | MESSAGE_CONTENT,
    onReady: catchUp,
    onEvent: (type, d) => {
      if (type === 'MESSAGE_CREATE') take(d);
      else if (type === 'MESSAGE_UPDATE') edit(d).catch((err) => log(`edit failed: ${err.message}`));
      else if (type === 'MESSAGE_DELETE') remove(d.id).catch((err) => log(`delete failed: ${err.message}`));
    },
  });
} else {
  log('DISCORD_BOT_TOKEN and DISCORD_LOG_AUTHOR are needed for replies; only taking messages');
}

createServer(async (req, res) => {
  const end = (status, body, headers = {}) => {
    res.writeHead(status, body === undefined ? headers : { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers });
    res.end(body);
  };
  try {
    const key = keyOf(req);
    const visitor = key && hash(key);

    if (req.url === '/api/message/push') {
      if (!visitor) return end(403);
      const { subscription, endpoint } = await readBody(req);
      if (req.method === 'POST') {
        if (!validSubscription(subscription)) return end(400);
        const kept = (pushes[visitor] ?? []).filter((s) => s.endpoint !== subscription.endpoint);
        pushes[visitor] = [...kept, { endpoint: subscription.endpoint }].slice(-5);
      } else if (req.method === 'DELETE') {
        pushes[visitor] = (pushes[visitor] ?? []).filter((s) => s.endpoint !== endpoint);
        if (!pushes[visitor].length) delete pushes[visitor];
      } else {
        return end(405);
      }
      await writeJson(PUSH, pushes);
      return end(204);
    }

    if (req.url !== '/api/message') return end(404);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const body = JSON.stringify({ conversations: visitor ? view(visitor) : [], push: vapid.public });
      return end(200, req.method === 'HEAD' ? '' : body);
    }
    if (req.method !== 'POST') return end(405);
    const data = await readBody(req);
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    if (!message || message.length > MAX_LENGTH) return end(400);
    if (data.website) return end(204);
    if (await tooBig(MESSAGES)) return end(503);

    const fresh = key ?? randomBytes(24).toString('base64url');
    const who = hash(fresh);
    let convo;
    if (data.convo) {
      convo = convos.get(data.convo);
      if (convo?.visitor !== who) return end(404);
    } else {
      convo = convoFor(randomBytes(6).toString('hex'), who);
    }
    const time = new Date().toISOString();
    const first = !convo.entries.length;
    const id = await post(convo, message, time);
    remember(convo, { from: 'you', time, text: message, discord: id });
    const line = { time, message, visitor: who, convo: convo.id, ...(id && { discord: id }), ...(first && convo.discordThread && { discordThread: convo.discordThread }) };
    await appendFile(MESSAGES, JSON.stringify(line) + '\n');
    end(200, JSON.stringify({ conversations: view(who), push: vapid.public }), { 'Set-Cookie': cookie(fresh) });
  } catch (err) {
    end(err.status ?? 400);
  }
}).listen(Number(process.env.INBOX_PORT ?? 8080));
