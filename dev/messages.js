import { execFileSync } from 'node:child_process';

const raw = execFileSync('ssh', ['momoka', 'cat ~/errr.in-inbox/messages.jsonl 2>/dev/null || true'], { encoding: 'utf8' });
const messages = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
if (!messages.length) console.log('no messages yet');
for (const { time, message } of messages) {
  console.log(`\n${new Date(time).toLocaleString()}\n${message}`);
}
