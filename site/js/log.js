(() => {
  const spot = document.querySelector('.log[data-src]');
  if (!spot) return;
  const win = spot.closest('.win');
  const REFRESH_MS = 60000;
  let last = '';
  let stream = null;

  const when = (iso) => {
    const d = new Date(iso);
    const month = d.toLocaleString('en', { month: 'short' }).toLowerCase();
    const time = d.toLocaleString('en', { hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(/\s/g, '');
    return `${month} ${d.getDate()} · ${time}`;
  };

  function show(entries) {
    if (!entries.length) {
      spot.replaceChildren(Object.assign(document.createElement('p'), { className: 'log-empty', textContent: 'nothing here yet' }));
      return;
    }
    spot.replaceChildren(...entries.map((entry) => {
      const item = Object.assign(document.createElement('article'), { className: 'log-entry' });
      const stamp = when(entry.time) + (entry.edited ? ' · edited' : '');
      item.append(Object.assign(document.createElement('time'), { dateTime: entry.time, textContent: stamp }));
      if (entry.text) item.append(Object.assign(document.createElement('p'), { textContent: entry.text }));
      for (const image of entry.images ?? []) {
        const img = Object.assign(document.createElement('img'), { src: image.src, alt: '', loading: 'lazy' });
        if (image.width && image.height) Object.assign(img, { width: image.width, height: image.height });
        item.append(img);
      }
      return item;
    }));
  }

  function take(text) {
    if (text === last) return;
    last = text;
    try {
      show(JSON.parse(text).entries ?? []);
    } catch {}
  }

  const wanted = () => document.visibilityState === 'visible' && !win?.hidden;

  async function fetchOnce() {
    try {
      const res = await fetch(spot.dataset.src, { cache: 'no-cache' });
      if (res.ok) take(await res.text());
    } catch {}
  }

  function sync() {
    if (!wanted()) {
      stream?.close();
      stream = null;
      return;
    }
    if (stream) return;
    if (!window.EventSource) return void fetchOnce();
    stream = new EventSource(`${spot.dataset.src}/stream`);
    stream.onmessage = (e) => take(e.data);
  }

  sync();
  setInterval(() => { if (wanted() && (!stream || stream.readyState === EventSource.CLOSED)) { stream = null; sync(); } }, REFRESH_MS);
  document.addEventListener('visibilitychange', sync);
  if (win) new MutationObserver(sync).observe(win, { attributes: true, attributeFilter: ['hidden'] });
})();
