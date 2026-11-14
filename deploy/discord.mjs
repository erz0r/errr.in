// the discord pieces log.mjs and inbox.mjs share. no dependencies: node 22 has fetch and WebSocket.
const GATEWAY = process.env.DISCORD_GATEWAY ?? 'wss://gateway.discord.gg/?v=10&encoding=json';
const FATAL = [4004, 4010, 4011, 4012, 4013, 4014];

export const API = process.env.DISCORD_API ?? 'https://discord.com/api/v10';
export const GUILD_MESSAGES = 1 << 9, MESSAGE_CONTENT = 1 << 15;

export const log = (...parts) => console.error(new Date().toISOString(), ...parts);

export const discord = (token, path, init = {}) => fetch(`${API}${path}`, {
  ...init,
  headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://errr.in, 1)', ...init.headers },
  signal: AbortSignal.timeout(15_000),
});

// message text the way a reader sees it, without discord's <@id> and <:emoji:id> markup
export function plain(message) {
  const users = new Map((message.mentions ?? []).map((u) => [u.id, u.global_name ?? u.username]));
  return (message.content ?? '')
    .replace(/<@!?(\d+)>/g, (_, id) => `@${users.get(id) ?? 'someone'}`)
    .replace(/<@&\d+>/g, '@role')
    .replace(/<#\d+>/g, '#channel')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(Number(s) * 1000).toISOString().slice(0, 16).replace('T', ' '))
    .trim();
}

// keeps a gateway connection open, reconnecting with backoff. onReady runs after every
// (re)connect, onEvent(type, data) for each dispatch.
export function connect({ token, intents, onReady, onEvent }) {
  let backoff = 5000;
  const open = () => {
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
        send({ op: 2, d: { token, intents, properties: { os: 'linux', browser: 'errr.in', device: 'errr.in' } } });
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
        onReady?.();
      } else if (op === 0) {
        onEvent?.(t, d);
      }
    });
    socket.addEventListener('close', ({ code }) => {
      clearInterval(beat);
      clearTimeout(first);
      clearTimeout(steady);
      if (FATAL.includes(code)) return log(`gateway refused the bot (${code}); check the token and the message content intent`);
      const delay = Math.max(backoff, pause);
      log(`gateway closed (${code}), reconnecting in ${Math.round(delay / 1000)}s`);
      setTimeout(open, delay);
      backoff = Math.min(backoff * 2, 300_000);
    });
    socket.addEventListener('error', () => {});
  };
  open();
}
