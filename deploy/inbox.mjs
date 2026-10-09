import { createServer } from 'node:http';
import { appendFile, stat } from 'node:fs/promises';

const FILE = '/data/messages.jsonl';
const MAX_FILE = 5_000_000;
const MAX_LENGTH = 2000;

createServer(async (req, res) => {
  const end = (status) => { res.writeHead(status); res.end(); };
  try {
    if (req.method !== 'POST' || req.url !== '/api/message') return end(404);
    if (!req.headers['content-type']?.startsWith('application/json')) return end(415);
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8000) return end(413);
    }
    const data = JSON.parse(body);
    const message = typeof data?.message === 'string' ? data.message.trim() : '';
    if (!message || message.length > MAX_LENGTH) return end(400);
    if (data.website) return end(204);
    if (((await stat(FILE).catch(() => null))?.size ?? 0) > MAX_FILE) return end(503);
    await appendFile(FILE, JSON.stringify({ time: new Date().toISOString(), message }) + '\n');
    end(204);
  } catch {
    end(400);
  }
}).listen(8080);
