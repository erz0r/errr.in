import puppeteer from 'puppeteer-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = pathToFileURL(resolve('site/index.html')).href;
const SHOW_NAMES = process.argv.includes('--names');

const VARIANTS = {
  'no effects': `.mapped { filter: none !important }
    .win-halo, .win-soft { display: none }
    .win-sharp { mask: none !important; -webkit-mask: none !important }`,
  'no filter': '.mapped { filter: none !important }',
  'filter on full page': '',
  'filter on viewport box': '.mapped { position: fixed; inset: 0; overflow: auto; min-height: 0 }',
};
const DEVICES = {
  'laptop 1440x900 @1x': { width: 1440, height: 900, deviceScaleFactor: 1 },
  'laptop 1440x900 @2x': { width: 1440, height: 900, deviceScaleFactor: 2 },
  'phone 390x844 @3x': { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const THROTTLES = [1, 4];
const SCROLL_PX = 3000;
const SCROLL_SPEED = 1500;

const GPU_FLAGS = { low: ['--force_low_power_gpu'], off: ['--disable-gpu'] };
const gpuMode = process.argv.find((a) => a.startsWith('--gpu='))?.slice(6);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  args: [
    '--window-size=1500,1000',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    ...(GPU_FLAGS[gpuMode] ?? []),
  ],
});
const page = (await browser.pages())[0];
const cdp = await page.createCDPSession();
const gpuInfo = await cdp.send('SystemInfo.getInfo').catch(() => null);
console.log(`GPU: ${gpuInfo?.gpu.devices.map((d) => d.deviceString).join(', ')}`);
console.log(`compositing: ${gpuInfo?.gpu.featureStatus?.gpu_compositing}`);

const rows = [];
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
for (const [deviceName, viewport] of Object.entries(DEVICES)) {
  if (only && !deviceName.includes(only)) continue;
  for (const throttle of THROTTLES) {
    for (const [variant, css] of Object.entries(VARIANTS)) {
      await page.setViewport(viewport);
      await page.goto(PAGE, { waitUntil: 'load' });
      if (css) await page.addStyleTag({ content: css });
      await makeTall(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await new Promise((r) => setTimeout(r, 500));

      const scroll = await measure(page, () => scrollGesture(cdp, viewport));
      const resize = await measure(page, () => resizeSweep(page, viewport));
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      rows.push({ device: deviceName, cpu: `${throttle}x`, variant, scroll, resize });
      console.error(`done: ${deviceName} cpu ${throttle}x ${variant}`);
    }
  }
}
await browser.close();
report(rows);

async function makeTall(page) {
  await page.evaluate(() => {
    const main = document.querySelector('.mapped');
    const wins = [...main.querySelectorAll('.win')];
    for (let i = 1; i <= 5; i++) {
      for (const w of wins) {
        const copy = w.cloneNode(true);
        copy.style.setProperty('--y', `calc(${w.style.getPropertyValue('--y')} + ${i * 90}vh)`);
        main.append(copy);
      }
    }
  });
}

async function scrollGesture(cdp, viewport) {
  const x = Math.round(viewport.width / 2), y = Math.round(viewport.height / 2);
  for (const yDistance of [-SCROLL_PX, SCROLL_PX]) {
    await cdp.send('Input.synthesizeScrollGesture', {
      x, y, yDistance, speed: SCROLL_SPEED, gestureSourceType: 'mouse', preventFling: true,
    });
  }
}

async function resizeSweep(page, viewport) {
  const steps = 30;
  for (let i = 0; i <= steps * 2; i++) {
    const t = i <= steps ? i / steps : 2 - i / steps;
    await page.setViewport({ ...viewport, width: Math.round(viewport.width * (1 - 0.4 * t)) });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  await page.setViewport(viewport);
}

async function measure(page, action) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__maxScroll = 0;
    const scroller = document.querySelector('.mapped');
    let last = performance.now();
    const tick = (t) => {
      if (!window.__frames) return;
      window.__frames.push(t - last);
      window.__maxScroll = Math.max(window.__maxScroll, scrollY, scroller.scrollTop);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.tracing.start({
    categories: [
      'devtools.timeline', 'disabled-by-default-devtools.timeline',
      'cc', 'viz', 'gpu', 'benchmark', 'toplevel', 'blink',
    ],
  });
  const t0 = Date.now();
  await action();
  const wallMs = Date.now() - t0;
  const trace = JSON.parse(new TextDecoder().decode(await page.tracing.stop()));
  const { frames, maxScroll } = await page.evaluate(() => {
    const f = window.__frames.slice(1);
    window.__frames = null;
    return { frames: f, maxScroll: window.__maxScroll };
  });
  return { ...summarize(trace.traceEvents, frames, wallMs), maxScroll };
}

function summarize(events, frames, wallMs) {
  const procs = {};
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'process_name') procs[e.pid] = e.args.name;
  }
  const durations = (name, proc) => events
    .filter((e) => e.ph === 'X' && e.name === name && (procs[e.pid] ?? '').startsWith(proc))
    .map((e) => (e.dur ?? 0) / 1000);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const pct = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  };

  const draws = durations('Display::DrawAndSwap', 'GPU');
  const mains = durations('ProxyMain::BeginMainFrame', 'Renderer');
  const vsync = pct(frames, 0.5);

  const result = {
    wallMs,
    drawn: draws.length,
    gpuP50: pct(draws, 0.5),
    gpuP95: pct(draws, 0.95),
    mainP50: pct(mains, 0.5),
    mainP95: pct(mains, 0.95),
    paint: sum(durations('Paint', 'Renderer')),
    raster: sum(durations('RasterTask', 'Renderer')),
    rafFrames: frames.length,
    rafLong: frames.filter((f) => f > vsync * 1.8).length,
  };
  if (SHOW_NAMES) {
    const byName = {};
    for (const e of events) {
      if (e.ph !== 'X' || !e.dur) continue;
      const k = `${procs[e.pid] ?? e.pid} | ${e.name}`;
      byName[k] = (byName[k] ?? 0) + e.dur / 1000;
    }
    result.top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 25);
  }
  return result;
}

function report(rows) {
  const f = (n) => n.toFixed(2);
  for (const kind of ['scroll', 'resize']) {
    console.log(`\n## ${kind}\n`);
    console.log('| device | cpu | variant | wall ms | scrolled px | frames drawn | GPU ms/frame p50 / p95 | main ms/frame p50 / p95 | paint ms total | raster ms total | missed rAF frames |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const m = r[kind];
      console.log(`| ${r.device} | ${r.cpu} | ${r.variant} | ${m.wallMs} | ${Math.round(m.maxScroll)} | ${m.drawn} | ${f(m.gpuP50)} / ${f(m.gpuP95)} | ${f(m.mainP50)} / ${f(m.mainP95)} | ${f(m.paint)} | ${f(m.raster)} | ${m.rafLong}/${m.rafFrames} |`);
      if (m.top) for (const [k, v] of m.top) console.log(`    ${f(v)}  ${k}`);
    }
  }
}
