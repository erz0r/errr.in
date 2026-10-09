const COPY = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
];

export function makeTestWindow(stage, { w, h, x, y, className = 'test', copy = COPY[Math.floor(Math.random() * COPY.length)] }) {
  const win = document.createElement('div');
  win.className = `win ${className}`;
  Object.assign(win.style, { width: `${w}px`, height: `${h}px`, left: `${x}px`, top: `${y}px` });
  win.innerHTML = `<div class="txt"><h2>[TEST] Lorem ipsum</h2><p>${copy}</p></div>`;
  stage.append(win);
  return win;
}

const nextFrame = () => new Promise(requestAnimationFrame);
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

async function measure(stage, count, ms) {
  const box = stage.getBoundingClientRect();
  const w = Math.min(280, box.width * 0.6), h = 170;
  const [cx, cy] = [box.width / 2 - w / 2, box.height / 2 - h / 2];
  const ring = Math.min(box.width, box.height) * 0.12;
  const wins = Array.from({ length: count }, (_, i) =>
    makeTestWindow(stage, { w, h, x: cx, y: cy, className: 'perf', copy: COPY[i % COPY.length] }));

  for (let i = 0; i < 20; i++) await nextFrame();
  const deltas = [];
  const start = performance.now();
  let last = start;
  for (let now = start; now - start < ms; now = await nextFrame()) {
    if (now !== start) deltas.push(now - last);
    last = now;
    const t = (now - start) / 1000;
    wins.forEach((win, i) => {
      const a = t * 1.5 + (i / count) * Math.PI * 2;
      win.style.left = `${cx + Math.cos(a) * ring}px`;
      win.style.top = `${cy + Math.sin(a) * ring}px`;
    });
  }
  wins.forEach((win) => win.remove());

  const seconds = (last - start) / 1000;
  return {
    fps: +(deltas.length / seconds).toFixed(1),
    p50ms: +pct(deltas, 0.5).toFixed(1),
    p95ms: +pct(deltas, 0.95).toFixed(1),
    worstMs: +Math.max(...deltas).toFixed(1),
    over25ms: `${deltas.filter((d) => d > 25).length}/${deltas.length}`,
  };
}

export async function runPerfTest(stage, onProgress) {
  const hidden = [...stage.querySelectorAll('.win')].filter((w) => !w.hidden);
  hidden.forEach((w) => { w.hidden = true; });
  const mapBefore = stage.dataset.map;
  const rows = [];
  try {
    for (const count of [1, 3, 6]) {
      for (const map of [true, false]) {
        stage.dataset.map = map ? 'on' : 'off';
        onProgress(`${count} window${count > 1 ? 's' : ''}, gradient map ${map ? 'on' : 'off'}…`);
        rows.push({ windows: count, map: map ? 'on' : 'off', ...(await measure(stage, count, 4000)) });
      }
    }
  } finally {
    if (mapBefore === undefined) delete stage.dataset.map; else stage.dataset.map = mapBefore;
    hidden.forEach((w) => { w.hidden = false; });
  }
  return {
    device: navigator.userAgent,
    dpr: devicePixelRatio,
    viewport: `${innerWidth}x${innerHeight}`,
    rows,
  };
}
