(() => {
  const about = document.querySelector('.stage .message'); // the send box on the about page
  const page = document.querySelector('.stage .messages'); // the messages window
  if (!about && !page) return;

  const POLL_MS = 30000;
  const SHOW = 30;
  const SEEN = 'inbox-seen';
  const SENT = 'sent, thank you ♡';
  const ROW = '<textarea name="message" rows="1" maxlength="2000" placeholder="say more.." aria-label="say more in this conversation"></textarea>'
    + '<button type="submit" aria-label="send"><svg viewBox="0 0 10 10"><path d="M3.5 1.5L7 5l-3.5 3.5"/></svg></button>';
  const pushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const when = (iso) => {
    const d = new Date(iso);
    const month = d.toLocaleString('en', { month: 'short' }).toLowerCase();
    const time = d.toLocaleString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
    return `${month} ${d.getDate()} · ${time}`;
  };
  const seen = {
    get() { try { return localStorage.getItem(SEEN) ?? ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem(SEEN, v); } catch {} },
  };
  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const newestFromErin = (conversations) => conversations
    .flatMap((c) => c.entries).filter((e) => e.from === 'erin').map((e) => e.time).sort().at(-1) ?? '';

  const aboutWin = about?.closest('.win');
  const pageWin = page?.closest('.win');
  const showing = (win) => document.visibilityState === 'visible' && win && !win.hidden;
  const wanted = () => showing(aboutWin) || showing(pageWin);
  const openLink = about?.querySelector('.message-links');
  const empty = page?.querySelector('.messages-empty');
  const list = page?.querySelector('.message-convos');
  const notify = page?.querySelector('.message-notify');
  const views = new Map();
  let push = null, conversations = [], last = '', loaded = false;

  // a textarea that grows, sends on enter, and shows how sending went
  function wire(form, sendIt) {
    const box = form.elements.message;
    const status = form.querySelector('.message-status');
    const button = form.querySelector('button');
    const placeholder = box.placeholder;
    const say = (text) => { status.textContent = text; };
    const fit = () => {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    box.addEventListener('input', () => { say(''); box.placeholder = placeholder; fit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = box.value.trim();
      if (!message || button.disabled) return;
      button.disabled = true;
      try {
        const res = await sendIt(message);
        if (res.ok) {
          box.value = '';
          fit();
          box.placeholder = SENT;
          say('');
        } else {
          say(res.status === 429 ? 'that was a lot at once, try again in a bit' : "couldn't send that, try again?");
        }
      } catch {
        say("couldn't send that, try again?");
      }
      button.disabled = false;
    });
  }

  async function send(body) {
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 200) show(await res.json().catch(() => ({})));
    return res;
  }

  // one conversation: the visitor's message, erin's answers, more back and forth, and a box to add to it
  function convoView(id) {
    const section = el('section', { className: 'message-convo' });
    const entries = el('ol', { className: 'message-entries' });
    const form = el('form', { className: 'message-box message-reply', noValidate: true });
    const row = el('div', { className: 'message-row', innerHTML: ROW });
    form.append(row, el('p', { className: 'message-status', role: 'status' }));
    section.append(entries, form);
    wire(form, (message) => send({ message, convo: id }));
    return { section, entries, text: '' };
  }

  // answers count as seen once the messages window has been looked at
  function markSeen() {
    const newest = newestFromErin(conversations);
    if (showing(pageWin) && newest > seen.get()) seen.set(newest);
    const link = openLink?.querySelector('a');
    if (link) link.textContent = `see your messages and replies${newest > seen.get() ? ' · new reply ♡' : ''}`;
  }

  function show(data) {
    push = data.push ?? push;
    loaded = true;
    conversations = data.conversations ?? [];
    const text = JSON.stringify(conversations);
    if (text !== last) {
      last = text;
      if (openLink) openLink.hidden = !conversations.length;
      if (empty) empty.hidden = conversations.length > 0;
      if (list) render();
    }
    markSeen();
    updateNotify();
  }

  function render() {
    for (const [id, view] of views) if (!conversations.some((c) => c.id === id)) { view.section.remove(); views.delete(id); }
    conversations.forEach((c, i) => {
      if (!views.has(c.id)) views.set(c.id, convoView(c.id));
      const view = views.get(c.id);
      const entriesText = JSON.stringify(c.entries);
      if (view.text !== entriesText) {
        view.text = entriesText;
        view.entries.replaceChildren(...c.entries.slice(-SHOW).map((entry) => {
          const item = el('li', { className: 'message-entry' });
          item.dataset.from = entry.from;
          const stamp = `${entry.from === 'erin' ? 'erin' : 'you'} · ${when(entry.time)}${entry.edited ? ' · edited' : ''}`;
          item.append(el('time', { dateTime: entry.time, textContent: stamp }), el('p', { textContent: entry.text }));
          return item;
        }));
      }
      // only move a conversation when it's out of place, so a half-typed reply keeps its focus
      if (list.children[i] !== view.section) list.insertBefore(view.section, list.children[i] ?? null);
    });
  }

  async function refresh() {
    if (!wanted()) return;
    try {
      const res = await fetch('/api/message', { cache: 'no-store' });
      if (res.ok) show(await res.json());
    } catch {}
  }

  // ---- notifications when erin answers, through a small service worker (/notify.js)
  const subscription = async () => (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription() ?? null;
  async function updateNotify() {
    if (!notify) return;
    if (!pushable || !push || !conversations.length || Notification.permission === 'denied') return void (notify.hidden = true);
    const on = Notification.permission === 'granted' && await subscription().catch(() => null);
    notify.textContent = on ? 'pings are on · turn off' : 'ping me when erin replies';
    notify.dataset.on = on ? '1' : '';
    notify.hidden = false;
  }
  notify?.addEventListener('click', async () => {
    notify.disabled = true;
    try {
      if (notify.dataset.on) {
        const sub = await subscription();
        if (sub) {
          await fetch('/api/message/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
          await sub.unsubscribe();
        }
      } else if (await Notification.requestPermission() === 'granted') {
        const reg = await navigator.serviceWorker.register('/notify.js');
        await navigator.serviceWorker.ready;
        const key = Uint8Array.from(atob(push.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const res = await fetch('/api/message/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
        if (!res.ok) await sub.unsubscribe();
      }
    } catch {}
    notify.disabled = false;
    updateNotify();
  });
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.open !== 'messages') return;
    location.hash = 'messages';
    refresh();
  });

  if (about) wire(about.querySelector('.message-new'), (message) => send({ message, website: about.querySelector('.message-new').elements.website.value }));

  // the conversation key is in an http-only cookie the page can't read, so the only way to know
  // whether there's anything to show is to ask: when either window first shows, then whenever one
  // comes back or every so often while there's a conversation
  const wake = () => {
    if (!wanted()) return;
    if (!loaded || conversations.length) refresh();
    markSeen();
  };
  wake();
  for (const win of [aboutWin, pageWin]) if (win) new MutationObserver(wake).observe(win, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', wake);
  setInterval(() => { if (conversations.length) refresh(); }, POLL_MS);
})();
