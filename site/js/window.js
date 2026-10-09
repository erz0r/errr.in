(() => {
  const stage = document.querySelector('.stage');
  const OFFSET = 32;
  const MARGIN = 16;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const opened = [];
  const closing = new Set();
  const openers = new Map();
  const startWindows = [...stage.querySelectorAll(':scope > .win:not([hidden]):not([data-shape])')];

  const byName = (name) => (name ? stage.querySelector(`.win[data-window="${CSS.escape(name)}"]`) : null);
  const fromHash = () => byName(decodeURIComponent(location.hash.slice(1)));
  const visibleWindows = () => [...stage.querySelectorAll(':scope > .win:not([hidden]):not([data-shape])')];
  const topmost = () => visibleWindows().filter((w) => !closing.has(w)).at(-1);
  const cssNumber = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
  const layout = () => getComputedStyle(document.documentElement).getPropertyValue('--window-layout').trim() || 'swap';
  const swapping = () => layout() === 'swap';
  const fadeMs = () => cssNumber('--fade-ms');
  const settling = () => layout() === 'pack' && cssNumber('--window-push') > 0;
  const stageBox = () => stage.getBoundingClientRect();

  function rectOf(win) {
    const box = stageBox(), r = win.getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
  }
  function moveTo(win, x, y) {
    Object.assign(win.style, { left: `${x}px`, top: `${y}px`, translate: 'none' });
  }

  const fades = new Map();
  const newPattern = () => [Math.random() * 4096, Math.random() * 4096, Math.random() * Math.PI * 2].map((v) => v.toFixed(3)).join(',');
  function fade(win, to, done, delay = 0, pattern = newPattern()) {
    const from = win.style.opacity === '' ? 1 : Number(win.style.opacity);
    const token = {};
    fades.set(win, token);
    win.dataset.fadeSeed = `${pattern},${to < from ? 1 : 0}`;
    const start = performance.now() + (reducedMotion.matches ? 0 : delay);
    const duration = reducedMotion.matches ? 0 : fadeMs() * Math.abs(to - from);
    const frame = (now) => {
      if (fades.get(win) !== token) return;
      if (now < start) return requestAnimationFrame(frame);
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      win.style.opacity = String(from + (to - from) * t);
      if (t < 1) return requestAnimationFrame(frame);
      fades.delete(win);
      if (to === 1) win.style.removeProperty('opacity');
      done?.();
    };
    requestAnimationFrame(frame);
  }

  function open(win, opener = topmost(), { back = false, anchor = null } = {}) {
    const popup = win.hasAttribute('data-popup');
    if (popup) anchors.set(win, anchor);
    let wait = 0, pattern;
    if (swapping() && !popup) {
      for (const other of visibleWindows()) if (other !== win && !closing.has(other)) hide(other);
      const leaving = visibleWindows().find((other) => other !== win && closing.has(other));
      if (leaving) {
        wait = fadeMs() * (1 - cssNumber('--fade-spread'));
        pattern = leaving.dataset.fadeSeed.split(',').slice(0, 3).join(',');
      }
    }
    if (win.hidden || closing.has(win)) {
      const wasHidden = win.hidden;
      if (wasHidden && !back && opener && opener !== win) {
        openers.set(win, opener);
        const button = win.querySelector('.back');
        if (button && !popup) button.hidden = false;
      }
      closing.delete(win);
      win.hidden = false;
      if (wasHidden) {
        win.style.opacity = '0';
        if (popup) placePopup(win);
        else if (settling() || swapping()) startInMiddle(win);
        else placeOffset(win, opener);
      }
      fade(win, 1, null, wait, pattern);
    }
    if (settling() && !popup) focusWindow(win);
    else stage.append(win);
    const i = opened.indexOf(win);
    if (i >= 0) opened.splice(i, 1);
    opened.push(win);
    (win.querySelector('[autofocus]') ?? win).focus({ preventScroll: true });
    showTitle();
  }

  const anchors = new Map();
  function placePopup(win) {
    const anchor = anchors.get(win);
    if (!anchor?.isConnected) return startInMiddle(win);
    const box = stageBox(), line = anchor.getClientRects()[0], w = win.offsetWidth, h = win.offsetHeight;
    const content = win.querySelector('.txt')?.firstElementChild;
    const inset = content ? content.getBoundingClientRect().left - win.getBoundingClientRect().left : 0;
    const tail = 12, gap = tail + cssNumber('--portal-reach') + 2 * cssNumber('--portal-blur') + 4;
    const x = Math.max(MARGIN, Math.min(line.left - box.left - inset, box.width - w - MARGIN));
    const y = Math.max(MARGIN, Math.min(line.top - box.top - h - gap, box.height - h - MARGIN));
    moveTo(win, x, y);
    const tipX = line.left - box.left + 4 - x;
    win.dataset.tail = y + h + gap <= line.top - box.top + 1 ? [tipX, h + tail, tipX + 3, tipX + 21].map((v) => v.toFixed(1)).join(',') : '';
  }

  addEventListener('tune:apply', () => visibleWindows().filter((w) => w.hasAttribute('data-popup')).forEach(placePopup));

  const openPopup = () => visibleWindows().find((w) => w.hasAttribute('data-popup') && !closing.has(w));

  function remember(win) {
    const hash = startWindows.includes(win) ? '' : `#${win.dataset.window}`;
    if (location.hash !== hash) history.pushState(null, '', hash || location.pathname + location.search);
  }

  function closePopup(popup) {
    const to = openers.get(popup) ?? startWindows[0];
    hide(popup);
    if (to && to !== popup) {
      open(to, popup, { back: true });
      remember(to);
    }
  }

  function showTitle() {
    const win = topmost();
    const name = win && !startWindows.includes(win) ? win.getAttribute('aria-label') : '';
    document.title = name ? `${name} · errr.in` : 'errr.in';
  }

  function hide(win) {
    const i = opened.indexOf(win);
    if (i >= 0) opened.splice(i, 1);
    closing.add(win);
    showTitle();
    fade(win, 0, () => {
      closing.delete(win);
      win.hidden = true;
      win.style.removeProperty('opacity');
      bodies.delete(win);
      if (anchor === win) anchor = null;
      planned = '';
      wake();
    });
  }

  function placeOffset(win, opener) {
    const box = stageBox(), w = win.offsetWidth, h = win.offsetHeight;
    let x = (box.width - w) / 2, y = (box.height - h) / 2;
    if (opener && opener !== win) {
      const r = rectOf(opener);
      [x, y] = [r.x + OFFSET, r.y + OFFSET];
    }
    const clamp = (v, room) => Math.max(MARGIN, Math.min(v, room - MARGIN));
    moveTo(win, clamp(x, box.width - w), clamp(y, box.height - h));
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = Object.assign(document.createElement('textarea'), { value: text });
      area.style.cssText = 'position: fixed; opacity: 0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('a[href^="copy:"]');
    if (!link) return;
    e.preventDefault();
    const ok = await copy(decodeURIComponent(link.getAttribute('href').slice(5)));
    const label = link.lastChild;
    if (!label || label.nodeType !== Node.TEXT_NODE || link.dataset.shown) return;
    link.dataset.shown = label.textContent;
    label.textContent = ok ? 'copied!' : 'copy failed';
    setTimeout(() => { label.textContent = link.dataset.shown; delete link.dataset.shown; }, 1400);
  });
  for (const link of stage.querySelectorAll('a[href^="copy:"]')) link.title = 'click to copy';

  document.addEventListener('click', (e) => {
    const back = e.target.closest('.back');
    const from = back?.closest('.win'), to = from && openers.get(from);
    if (from?.hasAttribute('data-popup')) return closePopup(from);
    if (to) {
      open(to, from, { back: true });
      remember(to);
      return;
    }
    const link = e.target.closest('a[href^="#"]');
    const win = link && byName(decodeURIComponent(link.getAttribute('href').slice(1)));
    if (link && !win && link.closest('.stage > .win')) {
      e.preventDefault();
      return;
    }
    if (win) {
      e.preventDefault();
      open(win, link.closest('.win'), { anchor: link });
      remember(win);
      return;
    }
    const clicked = e.target.closest('.stage > .win:not([data-shape])');
    if (!clicked || closing.has(clicked)) return;
    const selection = getSelection();
    if (!selection.isCollapsed && clicked.contains(selection.anchorNode)) return;
    if (settling()) focusWindow(clicked);
    else if (!swapping() && clicked !== topmost()) stage.append(clicked);
    showTitle();
  });

  document.addEventListener('click', (e) => {
    const popup = openPopup();
    if (!popup || popup.contains(e.target) || !stage.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    closePopup(popup);
  }, true);
  addEventListener('keydown', (e) => {
    const popup = e.key === 'Escape' && openPopup();
    if (popup) closePopup(popup);
  });

  addEventListener('popstate', () => {
    const target = fromHash();
    if (swapping()) {
      const show = target ?? startWindows[0];
      if (show) open(show, null, { back: true });
      return;
    }
    const keep = target ? opened.indexOf(target) : -1;
    if (target && keep < 0) return open(target);
    opened.slice(keep + 1).forEach(hide);
  });

  const SPRING = 50;
  const FRICTION = 2 * Math.sqrt(SPRING);
  const ANCHOR_EASE = 8;
  const SPOT_STEP = 16;
  const bodies = new Map();
  const targets = new Map();
  let planned = '';
  let anchor = null;
  let running = false, lastTime = 0, calmFrames = 0;

  const clearance = () => 2.6 * cssNumber('--halo-size') * cssNumber('--window-push');

  const onPage = (v, size, room) => Math.max(MARGIN, Math.min(v, room - size - MARGIN));
  const overlapArea = (a, b, pad) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + 2 * pad - 0.5) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + 2 * pad - 0.5);

  function body(win) {
    if (!bodies.has(win)) {
      const r = rectOf(win);
      moveTo(win, r.x, r.y);
      bodies.set(win, { x: r.x, y: r.y, vx: 0, vy: 0 });
    }
    return bodies.get(win);
  }

  function focusWindow(win) {
    anchor = win;
    planned = '';
    if (win !== topmost()) stage.append(win);
    wake();
  }

  function pickAnchor(wins) {
    if (anchor && wins.includes(anchor)) return anchor;
    const box = stageBox();
    const distance = (w) => {
      const r = rectOf(w);
      return Math.hypot(r.x + r.w / 2 - box.width / 2, r.y + r.h / 2 - box.height / 2);
    };
    anchor = wins.reduce((best, w) => (distance(w) < distance(best) ? w : best), wins[0]);
    return anchor;
  }

  function anchorHome(win, box) {
    const [w, h] = [win.offsetWidth, win.offsetHeight];
    return { x: onPage((box.width - w) / 2, w, box.width), y: onPage((box.height - h) / 2, h, box.height), w, h };
  }

  function spotsAround(ref, w, h, near, gap, placed) {
    const xs = [near.x], ys = [near.y];
    for (const p of placed) {
      xs.push(p.x, p.x + p.w - w, p.x + p.w + gap, p.x - gap - w);
      ys.push(p.y, p.y + p.h - h, p.y + p.h + gap, p.y - gap - h);
    }
    const along = (lo, hi, aligned) => {
      const values = aligned.filter((v) => v >= lo && v <= hi);
      for (let v = lo; v < hi; v += SPOT_STEP) values.push(v);
      values.push(hi);
      return values;
    };
    const spots = [];
    const [shareX, shareY] = [Math.min(w, ref.w) * 0.3, Math.min(h, ref.h) * 0.3];
    for (const y of along(ref.y - h + shareY, ref.y + ref.h - shareY, ys)) {
      spots.push({ x: ref.x + ref.w + gap, y }, { x: ref.x - gap - w, y });
    }
    for (const x of along(ref.x - w + shareX, ref.x + ref.w - shareX, xs)) {
      spots.push({ x, y: ref.y + ref.h + gap }, { x, y: ref.y - gap - h });
    }
    return spots;
  }

  function contact(c, p, gap) {
    const alongY = Math.min(c.y + c.h, p.y + p.h) - Math.max(c.y, p.y);
    const alongX = Math.min(c.x + c.w, p.x + p.w) - Math.max(c.x, p.x);
    const near = (a, b) => Math.abs(a - b) < 1;
    if (alongY > 20 && (near(c.x, p.x + p.w + gap) || near(c.x + c.w + gap, p.x))) return alongY / Math.min(c.h, p.h);
    if (alongX > 20 && (near(c.y, p.y + p.h + gap) || near(c.y + c.h + gap, p.y))) return alongX / Math.min(c.w, p.w);
    return 0;
  }

  const layoutKey = (wins, box) => `${Math.round(box.width)}x${Math.round(box.height)}|${wins.indexOf(anchor)}|`
    + wins.map((w) => `${w.offsetWidth}x${w.offsetHeight}`).join(',');

  function plan() {
    const box = stageBox(), pad = clearance(), gap = 2 * pad;
    const wins = visibleWindows().filter((w) => !closing.has(w) && !w.hasAttribute('data-popup'));
    targets.clear();
    if (!wins.length) return;
    const a = pickAnchor(wins);
    const placed = [anchorHome(a, box)];
    const [hx, hy] = [placed[0].x + placed[0].w / 2, placed[0].y + placed[0].h / 2];
    const [kx, ky] = [Math.min(1, (box.height / box.width) ** 2), Math.min(1, (box.width / box.height) ** 2)];
    const distance = (it) => Math.hypot(it.x + it.w / 2 - hx, it.y + it.h / 2 - hy);
    const free = wins
      .filter((w) => w !== a)
      .map((win) => ({ win, x: body(win).x, y: body(win).y, w: win.offsetWidth, h: win.offsetHeight }))
      .sort((p, q) => distance(p) - distance(q));
    const REFINE_PASSES = 3;
    const spotFor = (it, placed) => {
      let best = null, bestCost = Infinity;
      const consider = (spot) => {
        const c = { x: onPage(spot.x, it.w, box.width), y: onPage(spot.y, it.h, box.height), w: it.w, h: it.h };
        const overlap = placed.reduce((sum, p) => sum + overlapArea(c, p, pad), 0);
        const touches = placed.map((p) => contact(c, p, gap));
        const sides = touches.filter((t) => t > 0).length + (touches[0] > 0 ? 1 : 0);
        const shared = touches.reduce((sum, t) => sum + t, 0);
        const moved = Math.hypot((c.x - it.x) * kx, (c.y - it.y) * ky);
        const fromAnchor = Math.hypot((c.x + c.w / 2 - hx) * kx, (c.y + c.h / 2 - hy) * ky);
        const cost = overlap * 1e6 - sides * 1e4 - shared * 300 + fromAnchor * 0.5 + moved * 0.25;
        if (cost < bestCost) [best, bestCost] = [c, cost];
      };
      consider(it);
      for (const ref of placed) spotsAround(ref, it.w, it.h, it, gap, placed).forEach(consider);
      return { x: best.x, y: best.y };
    };

    const placedOf = new Map();
    for (const it of free) {
      const spot = spotFor(it, placed);
      const rect = { ...spot, w: it.w, h: it.h };
      placed.push(rect);
      placedOf.set(it, rect);
    }
    for (let pass = 0; pass < REFINE_PASSES; pass++) {
      for (const it of free) {
        const rect = placedOf.get(it);
        const others = placed.filter((p) => p !== rect);
        Object.assign(rect, spotFor({ ...it, x: rect.x, y: rect.y }, others));
      }
    }
    for (const it of free) targets.set(it.win, { x: placedOf.get(it).x, y: placedOf.get(it).y });
    planned = layoutKey(wins, box);
  }

  function startInMiddle(win) {
    const home = anchorHome(win, stageBox());
    moveTo(win, home.x, home.y);
    bodies.set(win, { x: home.x, y: home.y, vx: 0, vy: 0 });
  }

  function wake() {
    if (running || !settling()) return;
    running = true;
    calmFrames = 0;
    lastTime = performance.now();
    if (reducedMotion.matches) {
      for (let i = 0; i < 900 && step(1 / 60); i++);
      running = false;
    } else {
      requestAnimationFrame(frame);
    }
  }
  function frame(now) {
    const dt = Math.min(Math.max(now - lastTime, 1), 34) / 1000;
    lastTime = now;
    if (step(dt)) requestAnimationFrame(frame);
    else running = false;
  }

  function step(dt) {
    const wins = visibleWindows().filter((w) => !closing.has(w) && !w.hasAttribute('data-popup'));
    if (!settling() || !wins.length) return false;
    const box = stageBox();
    if (layoutKey(wins, box) !== planned) plan();
    const a = pickAnchor(wins);
    const home = anchorHome(a, box);
    const ease = 1 - Math.exp(-ANCHOR_EASE * dt);
    let motion = 0;
    for (const win of wins) {
      const b = body(win), [w, h] = [win.offsetWidth, win.offsetHeight];
      const [x0, y0] = [b.x, b.y];
      if (win === a) {
        b.x += (home.x - b.x) * ease;
        b.y += (home.y - b.y) * ease;
      } else {
        const t = targets.get(win) ?? b;
        b.vx += (SPRING * (t.x - b.x) - FRICTION * b.vx) * dt;
        b.vy += (SPRING * (t.y - b.y) - FRICTION * b.vy) * dt;
        b.x = onPage(b.x + b.vx * dt, w, box.width);
        b.y = onPage(b.y + b.vy * dt, h, box.height);
      }
      motion = Math.max(motion, Math.abs(b.x - x0), Math.abs(b.y - y0));
      moveTo(win, b.x, b.y);
    }
    calmFrames = motion < 0.05 ? calmFrames + 1 : 0;
    return calmFrames < 10;
  }

  const sizes = new ResizeObserver(() => {
    if (swapping()) visibleWindows().filter((w) => !closing.has(w) && !w.hasAttribute('data-popup')).forEach(startInMiddle);
    visibleWindows().filter((w) => w.hasAttribute('data-popup')).forEach(placePopup);
    wake();
  });
  sizes.observe(stage);
  stage.querySelectorAll('.win').forEach((win) => sizes.observe(win));
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.classList?.contains('win') && sizes.observe(n));
  }).observe(stage, { childList: true });

  for (const win of stage.querySelectorAll('.win[data-headings]')) {
    const key = `heading:${win.dataset.window}`;
    const last = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
    const all = JSON.parse(win.dataset.headings);
    const options = all.length > 1 ? all.filter((h) => h !== last) : all;
    const heading = win.querySelector('h1, h2');
    if (!heading || !options.length) continue;
    heading.textContent = options[Math.floor(Math.random() * options.length)];
    try { localStorage.setItem(key, heading.textContent); } catch {}
  }

  const linked = fromHash();
  if (linked) open(linked);
})();
