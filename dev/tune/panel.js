import { contrast, cssVars, hexToRgb, inkColor, inkGray, luminance, rampAt, rampHex, rgbToHex, sortedStops } from './settings.js';
import { GENERATORS, defaultParams, generatePalette } from './generator.js';
import { makeTestWindow, runPerfTest } from './test-windows.js';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('panel.css', import.meta.url);
document.head.append(css);

let saved = await (await fetch('/__tune/settings')).json();
let current = structuredClone(saved);
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

function section(title, ...children) {
  const body = el('div', 'section');
  body.append(...children);
  const hdr = el('div', 'hdr', `▾ ${title}`);
  hdr.onclick = () => {
    body.hidden = !body.hidden;
    hdr.textContent = `${body.hidden ? '▸' : '▾'} ${title}`;
  };
  return [hdr, body];
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
  return row;
}

const effectSliders = [];
function effectSlider(label, key, min, max, step, unit) {
  effectSliders.push({ key, min, max, step });
  return slider(label, () => current, key, min, max, step, unit);
}

function colorField(label, get, set) {
  const input = el('input');
  input.type = 'color';
  input.oninput = () => { set(input.value); changed(); };
  refreshers.push(() => { input.value = get(); });
  const row = el('div', 'row');
  row.append(input, el('span', 'lbl', label));
  return row;
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
    refresh();
  };
  revert.onclick = () => { current = structuredClone(saved); changed(); };
  compare.onpointerdown = () => apply(saved);
  compare.onpointerup = compare.onpointerleave = () => apply(current);

  refreshers.push(() => {
    const dirty = JSON.stringify(current) !== JSON.stringify(saved);
    status.textContent = dirty ? 'unsaved changes' : 'saved';
    status.className = dirty ? 'lbl dirty' : 'lbl';
  });
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
  row.append(box, el('span', 'lbl', 'gradient map (not saved)'));
  return row;
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

function layoutPicker() {
  const row = el('div', 'row');
  for (const layout of ['swap', 'pack', 'stack']) {
    const button = el('button', '', layout);
    button.onclick = () => { current.windowLayout = layout; changed(); };
    refreshers.push(() => button.classList.toggle('on', current.windowLayout === layout));
    row.append(button);
  }
  return row;
}

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
    status.textContent = `saved "${target}"`;
    show(await res.json());
  };
  fetch('/__tune/presets').then((r) => r.json()).then(show);
  const row = el('div', 'row');
  row.append(name, save);
  return [row, list, status];
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
  ...section('presets', ...presetControls()),
  ...section('effect',
    effectSlider('feather', 'feather', 0, 120, 1, 'px'),
    effectSlider('edge blur', 'edgeBlur', 0, 40, 0.5, 'px'),
    effectSlider('halo size', 'haloSize', 0, 160, 1, 'px'),
    effectSlider('halo glow', 'haloGlow', 0, 1, 0.01),
    effectSlider('stack glow', 'stackGlow', 0, 1, 0.01),
    randomizeButton(),
    mapToggle(),
  ),
  ...section('palette', ...paletteEditor(), generatorToggle(genWin), contrastReadout()),
  ...section('window',
    slider('text overlay', () => current, 'textOverlay', 0, 1, 0.01),
    slider('min text contrast', () => current, 'minContrast', 1, 12, 0.1, ':1'),
    colorField('background', () => current.window.bg, (v) => { current.window.bg = v; }),
    colorField('text', () => current.window.ink, (v) => { current.window.ink = v; }),
  ),
  ...section('liquid',
    slider('refraction', () => current, 'liquidRefract', 0, 60, 1, 'px'),
    slider('light', () => current, 'liquidLight', 0, 1, 0.01),
    slider('damping', () => current, 'liquidDamping', 0.9, 0.999, 0.001),
    slider('click splash', () => current, 'liquidClick', 0, 2, 0.01),
    slider('size', () => current, 'liquidSize', 2, 80, 1, 'px'),
    el('div', 'hint', 'off when the device asks for reduced motion'),
  ),
  ...section('windows',
    layoutPicker(),
    slider('fade time', () => current, 'fadeMs', 0, 2000, 10, 'ms'),
    slider('fade spread', () => current, 'fadeSpread', 0, 0.95, 0.01),
    slider('fade scale', () => current, 'fadeScale', 40, 1000, 10, 'px'),
    slider('spacing', () => current, 'windowPush', 0, 2, 0.05),
    el('div', 'hint', 'swap: one window at a time · pack: around the focused one (spacing 1 = glows just clear) · stack: offset'),
  ),
  ...section('test windows', ...windowControls()),
  ...section('perf test', ...perfControls()),
  ...section('file', ...fileControls()),
]);

addEventListener('keydown', (e) => {
  if (e.key === '`' && !e.target.closest?.('input')) document.body.classList.toggle('tune-hidden');
});

refresh();
