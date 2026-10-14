import { contrast, cssVars, hexToRgb, inkColor, inkGray, luminance, rampAt, rampHex, rgbToHex, sortedStops } from './settings.js';
import { GENERATORS, defaultParams, generatePalette } from './generator.js';
import { makeTestWindow, runPerfTest } from './test-windows.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('panel.css', import.meta.url);
document.head.append(css);

let saved = await (await fetch('/__tune/settings')).json();
let current = structuredClone(saved);
let baseline = structuredClone(saved);
let selected = current.palette[0];

const settingsStyle = document.getElementById('settings');
const stage = document.querySelector('.stage');

function apply(s) {
  settingsStyle.textContent = cssVars(s);
  const root = document.documentElement;
  root.dataset.ramp = rampHex(s.palette);
  dispatchEvent(new Event('tune:apply'));
}

const refreshers = [];
const refresh = () => refreshers.forEach((fn) => fn());
const changed = () => { apply(current); refresh(); };

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fractionAt = (e, box) => { const r = box.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };

function draggable(handle, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    handle.setPointerCapture(e.pointerId);
    onMove(e);
    const move = (m) => onMove(m);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
  });
}

const HELP = {
  feather: 'how far a window\'s edge fades into the page',
  edgeBlur: 'softens the window\'s outline under the fade',
  haloSize: 'how far the glow around each window reaches',
  haloGlow: 'how bright that glow is',
  stackGlow: 'how much a window\'s glow shows over the windows under it',
  textOverlay: 'draws the text again on top, so glows and her never cover it',
  minContrast: 'text is pushed lighter or darker until it reaches this contrast with its window',
  windowBg: 'its brightness picks the window\'s spot on the gradient map',
  windowInk: 'its brightness picks the text\'s spot on the gradient map',
  ditherAmount: '0 is smooth, 1 is fully dithered',
  ditherLevels: 'how many colors of the gradient map are left after dithering',
  ditherScale: 'the size of one dither dot',
  ditherSpread: 'at 0 the colors meet in hard bands, at 1 they blend through the pattern',
  ditherPattern: 'the shape the dots make',
  windowLayout: 'swap shows one window at a time, pack arranges them around the open one, stack offsets them',
  windowPush: 'room between windows in pack, where 1 means their glows just touch',
  fadeMs: 'how long a window takes to appear or vanish',
  fadeSpread: 'how patchy the fade is, where 0 fades evenly',
  fadeScale: 'how big the patches are',
  portalReach: 'how far the popup clears the page around itself',
  portalBlur: 'how soft that cleared edge is',
  insetTone: 'the box color, picked from the gradient map',
  insetMix: 'how much of that color shows. lower dithers it toward the window',
  insetInkTone: 'the text color inside boxes, picked from the gradient map',
  insetInkMix: 'how much of that text color shows',
  insetBlur: 'how soft the box edges are',
  sectPadX: 'room between a box\'s sides and its text',
  sectPadY: 'room above and below the text in a box',
  colsSplit: 'how much of the width the left box gets',
  colsGap: 'space around the dotted line',
  colsLowerGap: 'space between the boxes below the dotted line',
  modelX: 'move her left or right',
  modelY: 'move her up or down',
  modelSize: 'how big she is',
  modelTurn: 'which way she faces',
  imageBlack: 'grays in a picture below this all become the "from" color',
  imageWhite: 'grays in a picture above this all become the "to" color',
  imageGamma: 'brightens or darkens a picture\'s middle tones',
  imageFrom: 'the color a picture\'s darkest parts become, picked from the gradient map',
  imageFadeX: 'how far the left and right sides of pictures in the log fade into the box',
  imageFadeY: 'how far their top and bottom fade',
  imageTo: 'the color a picture\'s lightest parts become. put it left of "from" to flip the picture',
  modelLight: 'the main light on her',
  modelFill: 'the soft light that fills in her shadows',
  modelBlack: 'grays below this turn into the start of the gradient map',
  modelWhite: 'grays above this turn into the end of the gradient map',
  modelGamma: 'brightens or darkens her middle tones',
  shadowAngle: 'which side the sun shines from',
  shadowHeight: 'how high the sun is. lower makes a longer shadow',
  shadowStrength: 'how dark her shadow is',
  liquidRefract: 'how much ripples bend the page',
  liquidLight: 'how much ripples catch the light',
  liquidDamping: 'how long ripples keep going',
  liquidClick: 'how big a splash a click makes',
  liquidSize: 'how wide one splash is',
};

const store = {
  get: (k) => { try { return localStorage.getItem(`tune:${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`tune:${k}`, v); } catch {} },
};

function item(row, label, help = '') {
  const wrap = el('div', 'item');
  wrap.dataset.search = `${label} ${help}`.toLowerCase();
  if (help) row.title = help;
  wrap.append(row);
  if (help) wrap.append(el('div', 'desc', help));
  return wrap;
}

const sub = (text) => el('div', 'sub', text);

const OPEN = ['presets', 'colors'];
function section(title, ...children) {
  const body = el('div', 'section');
  body.append(...children);
  const hdr = el('div', 'hdr');
  const show = (open) => {
    body.hidden = !open;
    hdr.textContent = `${open ? '▾' : '▸'} ${title}`;
  };
  const saved = store.get(`open:${title}`);
  show(saved === null ? OPEN.includes(title) : saved === '1');
  hdr.onclick = () => {
    show(body.hidden);
    if (!document.querySelector('#tune input[type="text"]')?.value.trim()) store.set(`open:${title}`, body.hidden ? '0' : '1');
  };
  hdr.dataset.title = title;
  return [hdr, body];
}

function toolbar() {
  const search = el('input');
  search.type = 'text';
  search.placeholder = 'find a setting';
  const explain = el('input');
  explain.type = 'checkbox';
  const explainRow = el('label', 'row');
  explainRow.append(explain, el('span', 'lbl', 'explain each setting'));
  const setExplain = (on) => {
    explain.checked = on;
    document.getElementById('tune')?.classList.toggle('explain', on);
    store.set('explain', on ? '1' : '0');
  };
  explain.onchange = () => setExplain(explain.checked);
  requestAnimationFrame(() => setExplain(store.get('explain') !== '0'));
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    const panel = document.getElementById('tune');
    for (const hdr of panel.querySelectorAll('.hdr')) {
      const body = hdr.nextElementSibling;
      if (!q) {
        hdr.hidden = false;
        body.hidden = store.get(`open:${hdr.dataset.title}`) === null ? !OPEN.includes(hdr.dataset.title) : store.get(`open:${hdr.dataset.title}`) !== '1';
        hdr.textContent = `${body.hidden ? '▸' : '▾'} ${hdr.dataset.title}`;
        for (const child of body.children) child.style.display = '';
        continue;
      }
      let hits = 0, group = '';
      const whole = hdr.dataset.title.includes(q);
      for (const child of body.children) {
        if (child.classList.contains('sub')) group = child.textContent.toLowerCase();
        const hit = whole || (child.classList.contains('item') && (group.includes(q) || child.dataset.search.includes(q)));
        child.style.display = hit ? '' : 'none';
        hits += hit;
      }
      hdr.hidden = !hits;
      body.hidden = !hits;
      hdr.textContent = `${hits ? '▾' : '▸'} ${hdr.dataset.title}`;
    }
  };
  const row = el('div', 'row');
  row.append(search);
  return [row, explainRow];
}

const snap = (v, min, max, step) => +clamp(Math.round(v / step) * step, min, max).toFixed(4);

function slider(label, obj, key, min, max, step, unit = '', onSet = () => {}) {
  const box = el('div', 'slider');
  const fill = el('div', 'fill');
  const val = el('span', 'val');
  box.tabIndex = 0;
  box.append(fill, val);
  const set = (v) => { obj()[key] = snap(v, min, max, step); onSet(); changed(); };
  draggable(box, (e) => set(min + fractionAt(e, box) * (max - min)));
  box.onkeydown = (e) => {
    const d = { ArrowLeft: -step, ArrowRight: step }[e.key];
    if (d) { e.preventDefault(); set(obj()[key] + d); }
  };
  refreshers.push(() => {
    fill.style.width = `${((obj()[key] - min) / (max - min)) * 100}%`;
    val.textContent = `${obj()[key]}${unit}`;
  });
  const row = el('div', 'row');
  row.append(box, el('span', 'lbl', label));
  return item(row, label, HELP[key]);
}

const effectSliders = [];
function effectSlider(label, key, min, max, step, unit) {
  effectSliders.push({ key, min, max, step });
  return slider(label, () => current, key, min, max, step, unit);
}

function toneSlider(label, key) {
  const row = slider(label, () => current, key, 0, 1, 0.005);
  const box = row.querySelector('.slider'), fill = row.querySelector('.fill');
  row.querySelector('.val').style.textShadow = '0 0 2px #000, 0 0 3px #000, 0 0 4px #000';
  Object.assign(fill.style, { background: 'transparent', borderRight: '2px solid #fff', boxShadow: '1px 0 0 #000' });
  refreshers.push(() => {
    const stops = sortedStops(current.palette).map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ');
    box.style.background = `linear-gradient(90deg, ${stops})`;
  });
  return row;
}

function colorField(label, get, set, help) {
  const input = el('input');
  input.type = 'color';
  input.oninput = () => { set(input.value); changed(); };
  refreshers.push(() => { input.value = get(); });
  const row = el('div', 'row');
  row.append(input, el('span', 'lbl', label));
  return item(row, label, help);
}

function paletteEditor() {
  const strip = el('div', 'strip');
  const marks = el('div', 'marks');
  const markFor = new Map();

  strip.onclick = (e) => {
    const pos = +fractionAt(e, strip).toFixed(3);
    selected = { pos, color: rgbToHex(rampAt(current.palette, pos)) };
    current.palette.push(selected);
    changed();
  };

  const color = el('input');
  color.type = 'color';
  color.oninput = () => { selected.color = color.value; changed(); };
  const pos = el('span', 'lbl');
  const remove = el('button', '', 'delete');
  remove.onclick = () => {
    if (current.palette.length <= 2) return;
    current.palette.splice(current.palette.indexOf(selected), 1);
    selected = sortedStops(current.palette)[0];
    changed();
  };
  const stopRow = el('div', 'row');
  stopRow.append(color, pos, remove);

  refreshers.push(() => {
    if (!current.palette.includes(selected)) selected = sortedStops(current.palette)[0];
    const stops = sortedStops(current.palette);
    strip.style.background = `linear-gradient(to right, ${stops.map((s) => `${s.color} ${s.pos * 100}%`).join(', ')})`;

    for (const [stop, mark] of markFor) {
      if (!current.palette.includes(stop)) { mark.remove(); markFor.delete(stop); }
    }
    for (const stop of current.palette) {
      let mark = markFor.get(stop);
      if (!mark) {
        mark = el('div', 'mark');
        mark.tabIndex = 0;
        draggable(mark, (e) => { selected = stop; stop.pos = +fractionAt(e, marks).toFixed(3); changed(); });
        mark.onkeydown = (e) => {
          const d = { ArrowLeft: -0.005, ArrowRight: 0.005 }[e.key];
          if (d) { e.preventDefault(); selected = stop; stop.pos = +clamp(stop.pos + d, 0, 1).toFixed(3); changed(); }
        };
        markFor.set(stop, mark);
        marks.append(mark);
      }
      mark.style.left = `${stop.pos * 100}%`;
      mark.style.background = stop.color;
      mark.classList.toggle('sel', stop === selected);
    }
    color.value = selected.color;
    pos.textContent = `stop at ${selected.pos.toFixed(3)}`;
    remove.disabled = current.palette.length <= 2;
  });

  return [strip, marks, stopRow, el('div', 'hint', 'click strip: add stop · drag marker: move')];
}

function contrastReadout() {
  const line = el('div');
  const gray = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = (g) => { const [r, gr, b] = rampAt(current.palette, g); return 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  refreshers.push(() => {
    const bg = gray(current.window.bg), ink = inkColor(current);
    const adjusted = ink.override ? ' (shade of the window color)' : Math.abs(ink.gray - gray(current.window.ink)) > 1e-4 ? ' (auto-adjusted)' : '';
    const a = current.haloGlow * current.stackGlow;
    const alone = contrast(luminance(ink.color), lum(bg));
    const under = ink.override ? alone : ratio(ink.gray + (1 - ink.gray) * a, bg + (1 - bg) * a);
    line.textContent = `text ${alone.toFixed(2)}:1${adjusted} · under a window ${under.toFixed(2)}:1`;
    line.className = Math.min(alone, under) < 4.5 ? 'warn' : '';
    line.title = 'WCAG AA needs 4.5:1 for body text';
  });
  return line;
}

function fileControls() {
  const status = el('span', 'lbl');
  const save = el('button', '', 'save');
  const revert = el('button', '', 'revert');
  const compare = el('button', '', 'hold: saved');
  compare.title = 'Hold to see the last saved state';

  save.onclick = async () => {
    const res = await fetch('/__tune/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    });
    if (!res.ok) { status.textContent = `save failed: ${await res.text()}`; status.className = 'lbl warn'; return; }
    saved = await res.json();
    baseline = structuredClone(saved);
    refresh();
  };
  revert.onclick = () => { current = structuredClone(saved); baseline = structuredClone(saved); changed(); };
  compare.onpointerdown = () => apply(saved);
  compare.onpointerup = compare.onpointerleave = () => apply(current);

  refreshers.push(() => {
    const dirty = JSON.stringify(current) !== JSON.stringify(saved);
    status.textContent = dirty ? 'unsaved changes' : 'saved';
    status.className = dirty ? 'lbl dirty' : 'lbl';
  });
  function dragModel() {
  let grab = null;
  const overHer = (spot, e) => {
    const r = spot.getBoundingClientRect(), room = r.height * 0.3;
    return e.clientX > r.left + room && e.clientX < r.right - room && e.clientY > r.top + room && e.clientY < r.bottom - room;
  };
  addEventListener('pointerdown', (e) => {
    const spot = document.querySelector('.model');
    if (!spot || e.button !== 0 || e.target.closest('.tune-win')) return;
    if (!overHer(spot, e)) return;
    grab = { x: e.clientX, y: e.clientY, modelX: current.modelX, modelY: current.modelY, moving: false };
  }, true);
  addEventListener('pointermove', (e) => {
    if (!grab) return;
    const [dx, dy] = [e.clientX - grab.x, e.clientY - grab.y];
    if (!grab.moving && Math.hypot(dx, dy) < 4) return;
    if (!grab.moving) {
      grab.moving = true;
      getSelection().removeAllRanges();
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    }
    const k = parseFloat(getComputedStyle(document.documentElement).fontSize) / 14 || 1;
    current.modelX = clamp(Math.round(grab.modelX + dx / k), -900, 900);
    current.modelY = clamp(Math.round(grab.modelY + dy / k), -900, 900);
    changed();
  }, true);
  const drop = (e) => {
    if (grab?.moving) {
      e.preventDefault();
      const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
      addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', eat, true));
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    grab = null;
  };
  addEventListener('pointerup', drop, true);
  addEventListener('pointercancel', drop, true);
  addEventListener('wheel', (e) => {
    const spot = document.querySelector('.model');
    if (!spot || e.target.closest('.tune-win')) return;
    if (!overHer(spot, e)) return;
    e.preventDefault();
    const delta = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 33 : 1);
    if (e.shiftKey) current.modelTurn = Math.round((((current.modelTurn - delta * 0.05 + 540) % 360) + 360) % 360 - 180);
    else current.modelSize = +clamp(current.modelSize * Math.exp(-delta * 0.001), 0.3, 2.5).toFixed(3);
    changed();
  }, { capture: true, passive: false });
}
dragModel();

addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save.click(); }
  });

  const row = el('div', 'row');
  row.append(save, revert, compare);
  return [row, status];
}

function randomizeButton() {
  const button = el('button', '', 'randomize');
  button.onclick = () => {
    for (const { key, min, max, step } of effectSliders) current[key] = snap(min + Math.random() * (max - min), min, max, step);
    changed();
  };
  const row = el('div', 'row');
  row.append(button);
  return row;
}

function mapToggle() {
  const box = el('input');
  box.type = 'checkbox';
  box.checked = true;
  box.onchange = () => { stage.dataset.map = box.checked ? 'on' : 'off'; };
  const row = el('label', 'row');
  row.append(box, el('span', 'lbl', 'gradient map on'));
  return item(row, 'gradient map', 'turn it off to see the gray image underneath. not saved');
}

function floatingWindow(id, titleText, children) {
  const win = el('div', 'tune-win');
  win.id = id;
  const title = el('div', 'title', titleText);
  const body = el('div', 'body');
  body.append(...children);
  win.append(title, body);
  title.addEventListener('pointerdown', (e) => {
    const r = win.getBoundingClientRect();
    const [dx, dy, x0, y0] = [e.clientX - r.left, e.clientY - r.top, e.clientX, e.clientY];
    title.setPointerCapture(e.pointerId);
    const move = (m) => {
      win.style.left = `${m.clientX - dx}px`;
      win.style.top = `${m.clientY - dy}px`;
      win.style.right = 'auto';
    };
    title.addEventListener('pointermove', move);
    title.addEventListener('pointerup', (u) => {
      title.removeEventListener('pointermove', move);
      if (Math.hypot(u.clientX - x0, u.clientY - y0) < 3) body.hidden = !body.hidden;
    }, { once: true });
  });
  document.body.append(win);
  return win;
}

function generatorWindow() {
  const gen = { mode: 'oklch' };
  for (const [name, generator] of Object.entries(GENERATORS)) gen[name] = defaultParams(generator);
  const regenerate = () => { current.palette = generatePalette(GENERATORS[gen.mode], gen[gen.mode]); };
  const words = (key) => key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`);

  const modes = el('div', 'row');
  const groups = [];
  for (const [name, generator] of Object.entries(GENERATORS)) {
    const pick = el('button', '', generator.label);
    pick.onclick = () => { gen.mode = name; regenerate(); changed(); };
    modes.append(pick);
    const group = el('div', 'section');
    group.append(...Object.entries(generator.params).map(([key, [, min, max, step]]) =>
      slider(words(key), () => gen[name], key, min, max, step, '', regenerate)));
    groups.push(group);
    refreshers.push(() => {
      pick.classList.toggle('on', gen.mode === name);
      group.hidden = gen.mode !== name;
    });
  }

  const randomize = el('button', '', 'randomize');
  randomize.onclick = () => {
    const p = gen[gen.mode];
    for (const [key, [, min, max, step]] of Object.entries(GENERATORS[gen.mode].params)) {
      if (key !== 'stops') p[key] = snap(min + Math.random() * (max - min), min, max, step);
    }
    regenerate();
    changed();
  };
  const reset = el('button', '', 'defaults');
  reset.onclick = () => { gen[gen.mode] = defaultParams(GENERATORS[gen.mode]); regenerate(); changed(); };
  const buttons = el('div', 'row');
  buttons.append(randomize, reset);

  const win = floatingWindow('tune-gen', 'palette generator', [
    modes, ...groups, buttons,
    el('div', 'hint', 'any change replaces the palette · revert undoes'),
  ]);
  win.hidden = true;
  return win;
}

function windowControls() {
  const add = el('button', '', 'add window');
  add.onclick = () => {
    const [w, h] = [260 + Math.random() * 120, 170 + Math.random() * 70];
    const box = stage.getBoundingClientRect();
    makeTestWindow(stage, { w, h, x: Math.random() * Math.max(0, box.width - w), y: Math.random() * Math.max(0, box.height - h) });
  };
  const clear = el('button', '', 'clear test windows');
  clear.onclick = () => stage.querySelectorAll('.win.test').forEach((w) => w.remove());
  const row = el('div', 'row');
  row.append(add, clear);
  return [row, el('div', 'hint', 'not saved · reload to clear')];
}

function perfControls() {
  const run = el('button', '', 'run perf test (~30s)');
  const out = el('pre', 'hint');
  run.onclick = async () => {
    run.disabled = true;
    try {
      const result = await runPerfTest(stage, (msg) => { out.textContent = msg; });
      out.textContent = result.rows
        .map((r) => `${r.windows} win, map ${r.map.padEnd(3)}  ${String(r.fps).padStart(5)} fps  p95 ${r.p95ms}ms  >25ms ${r.over25ms}`)
        .join('\n');
      await fetch('/__tune/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) })
        .then(() => { out.textContent += '\nsent to the dev server'; }, () => { out.textContent += '\ncould not reach the dev server'; });
    } finally {
      run.disabled = false;
    }
  };
  const row = el('div', 'row');
  row.append(run);
  return [row, out];
}

function choiceRow(key, options, label) {
  const row = el('div', 'row choices');
  for (const option of options) {
    const button = el('button', '', option);
    button.onclick = () => { current[key] = option; changed(); };
    refreshers.push(() => button.classList.toggle('on', current[key] === option));
    row.append(button);
  }
  return item(row, `${label} ${options.join(' ')}`, HELP[key]);
}

const layoutPicker = () => choiceRow('windowLayout', ['swap', 'pack', 'stack'], 'layout');

function presetControls() {
  const cleanName = (n) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const name = el('input');
  name.type = 'text';
  name.placeholder = 'preset name';
  const save = el('button', '', 'save preset');
  const status = el('div', 'hint', 'a preset is every setting. each visit picks one at random (not while tuning). ctrl+s saves settings.json, the default.');
  const list = el('div', 'section');
  let presets = [];
  let loaded = null;
  const strip = (palette) => {
    const s = el('div', 'mini-strip');
    s.style.background = `linear-gradient(to right, ${sortedStops(palette).map((p) => `${p.color} ${p.pos * 100}%`).join(', ')})`;
    return s;
  };
  const show = (next) => {
    presets = next;
    list.replaceChildren(...presets.map((preset) => {
      const load = el('button', preset.name === loaded ? 'on' : '', 'load');
      load.onclick = () => {
        current = structuredClone(preset.settings);
        baseline = structuredClone(preset.settings);
        loaded = name.value = preset.name;
        status.textContent = `loaded "${preset.name}". save writes back to it.`;
        changed();
        show(presets);
      };
      const remove = el('button', '', 'delete');
      remove.onclick = async () => {
        if (!confirm(`delete the preset "${preset.name}"?`)) return;
        const res = await fetch(`/__tune/presets/${encodeURIComponent(preset.name)}`, { method: 'DELETE' });
        if (!res.ok) return void (status.textContent = `delete failed: ${await res.text()}`);
        if (loaded === preset.name) loaded = null;
        show(await res.json());
      };
      const row = el('div', 'row');
      row.append(strip(preset.settings.palette), el('span', 'lbl', preset.name), load, remove);
      return row;
    }));
  };
  save.onclick = async () => {
    const target = cleanName(name.value);
    if (!target) return void (status.textContent = 'type a name first');
    if (target !== loaded && presets.some((p) => p.name === target) && !confirm(`replace the preset "${target}"?`)) return;
    const res = await fetch('/__tune/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: target, settings: current }),
    });
    if (!res.ok) return void (status.textContent = `save failed: ${await res.text()}`);
    loaded = name.value = target;
    baseline = structuredClone(current);
    status.textContent = `saved "${target}"`;
    show(await res.json());
  };
  const toAll = el('button', '', 'apply changes to all presets');
  toAll.onclick = async () => {
    const keys = Object.keys(current).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(baseline[k]));
    if (!keys.length) return void (status.textContent = 'nothing changed since the last load or save');
    if (!presets.length) return void (status.textContent = 'there are no presets yet');
    if (!confirm(`copy ${keys.join(', ')} into all ${presets.length} presets? their other settings stay as they are.`)) return;
    let res;
    for (const preset of presets) {
      const settings = { ...preset.settings, ...Object.fromEntries(keys.map((k) => [k, structuredClone(current[k])])) };
      res = await fetch('/__tune/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: preset.name, settings }),
      });
      if (!res.ok) return void (status.textContent = `stopped at "${preset.name}": ${await res.text()}`);
    }
    baseline = structuredClone(current);
    status.textContent = `updated ${keys.join(', ')} in all ${presets.length} presets`;
    show(await res.json());
  };
  fetch('/__tune/presets').then((r) => r.json()).then(show);
  const row = el('div', 'row');
  row.append(name, save);
  const allRow = el('div', 'row');
  allRow.append(toAll);
  return [row, list, allRow, status];
}

function generatorToggle(win) {
  const button = el('button', '', 'generator…');
  button.onclick = () => { win.hidden = !win.hidden; };
  const row = el('div', 'row');
  row.append(button);
  return row;
}

const genWin = generatorWindow();
floatingWindow('tune', 'tune   ` to hide', [
  ...toolbar(),
  ...section('presets', ...presetControls()),
  ...section('save', ...fileControls()),
  ...section('colors',
    ...paletteEditor(), generatorToggle(genWin),
    sub('window'),
    colorField('window', () => current.window.bg, (v) => { current.window.bg = v; }, HELP.windowBg),
    colorField('text', () => current.window.ink, (v) => { current.window.ink = v; }, HELP.windowInk),
    slider('min contrast', () => current, 'minContrast', 1, 12, 0.1, ':1'),
    contrastReadout(),
    mapToggle(),
  ),
  ...section('glow & edges',
    effectSlider('feather', 'feather', 0, 200, 1, 'px'),
    effectSlider('edge blur', 'edgeBlur', 0, 100, 0.5, 'px'),
    effectSlider('glow size', 'haloSize', 0, 300, 1, 'px'),
    effectSlider('glow strength', 'haloGlow', 0, 1, 0.01),
    effectSlider('glow over windows', 'stackGlow', 0, 1, 0.01),
    slider('text on top', () => current, 'textOverlay', 0, 1, 0.01),
    randomizeButton(),
  ),
  ...section('dither',
    slider('amount', () => current, 'ditherAmount', 0, 1, 0.01),
    slider('steps', () => current, 'ditherLevels', 2, 32, 1),
    slider('dot size', () => current, 'ditherScale', 1, 8, 0.5, 'px'),
    slider('blend', () => current, 'ditherSpread', 0, 1, 0.01),
    choiceRow('ditherPattern', ['bayer2', 'bayer4', 'bayer8', 'noise', 'lines', 'diagonal'], 'pattern'),
  ),
  ...section('windows',
    layoutPicker(),
    slider('spacing', () => current, 'windowPush', 0, 2, 0.05),
    sub('fade in and out'),
    slider('time', () => current, 'fadeMs', 0, 2000, 10, 'ms'),
    slider('patchiness', () => current, 'fadeSpread', 0, 0.95, 0.01),
    slider('patch size', () => current, 'fadeScale', 40, 1000, 10, 'px'),
    sub('message popup'),
    slider('clearing', () => current, 'portalReach', 0, 120, 1, 'px'),
    slider('clearing blur', () => current, 'portalBlur', 0, 40, 0.5, 'px'),
  ),
  ...section('about page boxes',
    sub('color'),
    toneSlider('box', 'insetTone'),
    slider('box amount', () => current, 'insetMix', 0, 1, 0.01),
    toneSlider('text', 'insetInkTone'),
    slider('text amount', () => current, 'insetInkMix', 0, 1, 0.01),
    slider('edge blur', () => current, 'insetBlur', 0, 40, 0.5, 'px'),
    sub('size'),
    slider('padding sides', () => current, 'sectPadX', 0, 80, 1, 'px'),
    slider('padding top', () => current, 'sectPadY', 0, 80, 1, 'px'),
    slider('left box width', () => current, 'colsSplit', 0.15, 0.85, 0.01),
    slider('line gap', () => current, 'colsGap', 0, 120, 1, 'px'),
    slider('lower gap', () => current, 'colsLowerGap', 0, 120, 1, 'px'),
  ),
  ...section('images',
    toneSlider('from', 'imageFrom'),
    toneSlider('to', 'imageTo'),
    slider('black point', () => current, 'imageBlack', 0, 1, 0.01),
    slider('white point', () => current, 'imageWhite', 0, 1, 0.01),
    slider('gamma', () => current, 'imageGamma', 0.2, 3, 0.01),
    slider('side fade', () => current, 'imageFadeX', 0, 200, 1, 'px'),
    slider('top/bottom fade', () => current, 'imageFadeY', 0, 200, 1, 'px'),
    el('div', 'hint', 'for pictures in the log and in windows'),
  ),
  ...section('erinsona',
    el('div', 'hint', 'on the page: drag her to move, scroll over her to resize, shift+scroll to turn'),
    sub('place'),
    slider('x', () => current, 'modelX', -900, 900, 1, 'px'),
    slider('y', () => current, 'modelY', -900, 900, 1, 'px'),
    slider('size', () => current, 'modelSize', 0.3, 2.5, 0.01),
    slider('turn', () => current, 'modelTurn', -180, 180, 1, '°'),
    sub('light'),
    slider('key light', () => current, 'modelLight', 0, 6, 0.05),
    slider('fill light', () => current, 'modelFill', 0, 4, 0.05),
    slider('black point', () => current, 'modelBlack', 0, 1, 0.01),
    slider('white point', () => current, 'modelWhite', 0, 1, 0.01),
    slider('gamma', () => current, 'modelGamma', 0.2, 3, 0.01),
    sub('shadow'),
    slider('sun direction', () => current, 'shadowAngle', -180, 180, 1, '°'),
    slider('sun height', () => current, 'shadowHeight', 5, 85, 1, '°'),
    slider('darkness', () => current, 'shadowStrength', 0, 1, 0.01),
  ),
  ...section('ripples',
    slider('bend', () => current, 'liquidRefract', 0, 60, 1, 'px'),
    slider('shine', () => current, 'liquidLight', 0, 1, 0.01),
    slider('how long', () => current, 'liquidDamping', 0.9, 0.999, 0.001),
    slider('click splash', () => current, 'liquidClick', 0, 2, 0.01),
    slider('splash size', () => current, 'liquidSize', 2, 80, 1, 'px'),
    el('div', 'hint', 'off when the device asks for reduced motion'),
  ),
  ...section('testing', sub('test windows'), ...windowControls(), sub('performance'), ...perfControls()),
]);

addEventListener('keydown', (e) => {
  if (e.key === '`' && !e.target.closest?.('input, textarea')) document.body.classList.toggle('tune-hidden');
});

refresh();
