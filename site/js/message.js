(() => {
  const POLL_MS = 30000;
  const SHOW = 30;
  const SEEN = 'inbox-seen';
  const SENT = 'sent, thank you ♡';
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

  for (const root of document.querySelectorAll('.message')) {
    const main = root.querySelector('.message-new');
    const inbox = root.querySelector('.message-inbox');
    const toggle = root.querySelector('.message-toggle');
    const notify = root.querySelector('.message-notify');
    const list = root.querySelector('.message-convos');
    const win = root.closest('.win');
    const views = new Map();
    let push = null, last = '', count = 0, asked = false;

    const wanted = () => document.visibilityState === 'visible' && !win?.hidden;

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
      const row = main.querySelector('.message-row').cloneNode(true);
      const box = row.querySelector('textarea');
      Object.assign(box, { value: '', placeholder: 'say more..' });
      box.setAttribute('aria-label', 'reply in this conversation');
      box.style.height = '';
      row.querySelector('button').disabled = false; // copied mid-send, when the main one is disabled
      form.append(row, el('p', { className: 'message-status', role: 'status' }));
      section.append(entries, form);
      wire(form, (message) => send({ message, convo: id }));
      return { section, entries, text: '' };
    }

    function openList(open) {
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      markSeen();
    }

    function markSeen() {
      const newest = newestFromErin(JSON.parse(last || '[]'));
      if (!list.hidden && wanted() && newest > seen.get()) seen.set(newest);
      const unread = newestFromErin(JSON.parse(last || '[]')) > seen.get();
      toggle.textContent = list.hidden ? `see your messages and replies${unread ? ' · new reply ♡' : ''}` : 'hide your messages';
    }

    function show(data) {
      push = data.push ?? push;
      const conversations = data.conversations ?? [];
      const text = JSON.stringify(conversations);
      if (text === last) return;
      last = text;
      count = conversations.length;
      inbox.hidden = !count;
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
      if (newestFromErin(conversations) > seen.get() && list.hidden && wanted()) openList(true);
      markSeen();
      updateNotify();
    }

    async function refresh() {
      if (!wanted()) return;
      try {
        const res = await fetch('/api/message', { cache: 'no-store' });
        if (res.ok) show(await res.json());
      } catch {}
    }

    // ---- notifications when erin answers, through a small service worker (/notify.js)
    const registration = () => navigator.serviceWorker.getRegistration('/');
    const subscription = async () => (await registration())?.pushManager.getSubscription() ?? null;
    async function updateNotify() {
      if (!pushable || !push || !count || Notification.permission === 'denied') return void (notify.hidden = true);
      const on = Notification.permission === 'granted' && await subscription().catch(() => null);
      notify.textContent = on ? 'pings are on · turn off' : 'ping me when erin replies';
      notify.dataset.on = on ? '1' : '';
      notify.hidden = false;
    }
    notify.addEventListener('click', async () => {
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
      if (e.data?.open !== 'about') return;
      location.hash = 'about';
      refresh();
    });

    toggle.addEventListener('click', () => openList(list.hidden));
    wire(main, (message) => send({ message, website: main.elements.website.value }));

    // the conversation key is in an http-only cookie the page can't read, so the only way to
    // know whether there's anything to show is to ask: once when the box first shows, then
    // whenever it comes back or every so often while there's a conversation
    const wake = () => {
      if (count) refresh();
      else if (!asked && wanted()) { asked = true; refresh(); }
      markSeen();
    };
    wake();
    if (win) new MutationObserver(wake).observe(win, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', wake);
    setInterval(() => { if (count) refresh(); }, POLL_MS);
  }
})();
