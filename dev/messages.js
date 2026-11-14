import { execFileSync } from 'node:child_process';

const read = (file) => execFileSync('ssh', ['momoka', `cat ~/errr.in-inbox/${file} 2>/dev/null || true`], { encoding: 'utf8' })
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const messages = read('messages.jsonl');
const replies = read('replies.jsonl');
if (!messages.length) console.log('no messages yet');

// replay erin's answers (with their edits and deletes) the way the inbox does
const answers = new Map();
for (const r of replies) {
  if (r.deleted) answers.delete(r.discord);
  else if (r.edited) { if (answers.has(r.discord)) answers.get(r.discord).text = r.reply; }
  else answers.set(r.discord, { from: 'erin', time: r.time, text: r.reply, convo: r.convo });
}

// messages from before conversations existed go together at the top
const convos = new Map();
for (const m of messages) {
  const key = m.convo ?? 'old';
  if (!convos.has(key)) convos.set(key, { visitor: m.visitor, entries: [] });
  convos.get(key).entries.push({ from: 'them', time: m.time, text: m.message });
}
for (const a of answers.values()) convos.get(a.convo)?.entries.push(a);

const when = (iso) => new Date(iso).toLocaleString();
for (const { visitor, entries } of convos.values()) {
  entries.sort((a, b) => a.time.localeCompare(b.time));
  console.log(`\n── ${visitor ? visitor.slice(0, 6) : 'from before replies existed'} ${'─'.repeat(30)}`);
  for (const e of entries) console.log(`${e.from === 'erin' ? '  erin' : 'them'} · ${when(e.time)}\n${e.from === 'erin' ? '  ' : ''}${e.text.replace(/\n/g, e.from === 'erin' ? '\n  ' : '\n')}`);
}
