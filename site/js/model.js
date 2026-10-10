const spot = document.querySelector('.model[data-src]');
const win = spot?.closest('.win');

if (spot && win) {
  const root = document.documentElement;
  const css = (name, fallback) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || fallback;
  const shown = () => !win.hidden && document.visibilityState === 'visible';
  const between = (lo, hi) => lo + Math.random() * (hi - lo);
  const send = (detail) => dispatchEvent(new CustomEvent('model:frame', { detail: { spot, ...detail } }));
  let started = false;

  // phones have no cursor for her to follow, so they play a loop baked from this same scene
  // (dev/bake-model.js) instead of running three.js. the tuning panel always gets the live model.
  function loopUrl() {
    if (!matchMedia('(hover: none)').matches || new URLSearchParams(location.search).has('tune')) return null;
    const loops = JSON.parse(spot.dataset.loops ?? '{}');
    return loops[`${css('--model-light', 1.3)},${css('--model-fill', 0.5)}`] ?? null;
  }

  function startLoop(src) {
    const video = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, preload: 'auto', src });
    video.setAttribute('aria-hidden', 'true');
    spot.append(video);
    const play = () => { if (shown()) video.play().catch(() => {}); else video.pause(); };
    new MutationObserver(play).observe(win, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', play);
    if (video.requestVideoFrameCallback) {
      const frame = () => { send({ video }); video.requestVideoFrameCallback(frame); };
      video.requestVideoFrameCallback(frame);
    } else {
      let last = -1;
      const poll = () => {
        if (video.readyState >= 2 && video.currentTime !== last) { last = video.currentTime; send({ video }); }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
    // a paused video (low power mode blocks autoplay) still shows her first frame
    video.addEventListener('loadeddata', () => send({ video }), { once: true });
    play();
  }

  async function startLive() {
    const [THREE, { createScene }] = await Promise.all([import(spot.dataset.engine), import(spot.dataset.scene)]);
    const canvas = document.createElement('canvas');
    const her = await createScene(THREE, spot.dataset.src, canvas, { light: css('--model-light', 1.3), fill: css('--model-fill', 0.5) });
    addEventListener('tune:apply', () => her.setLight(css('--model-light', 1.3), css('--model-fill', 0.5)));

    const look = { yaw: 0, pitch: 0 }, aim = { yaw: 0, pitch: 0 };
    addEventListener('pointermove', (e) => {
      if (!her.head) return;
      const p = her.head.getWorldPosition(new THREE.Vector3()).project(her.camera);
      const r = spot.getBoundingClientRect();
      const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
      const clamp = (v, m) => Math.max(-m, Math.min(m, v));
      aim.yaw = clamp(Math.atan2(e.clientX - x, 500), 0.6);
      aim.pitch = clamp(Math.atan2(e.clientY - y, 500), 0.4);
    });

    const now0 = performance.now() / 1000;
    const blink = { at: -1e9, twice: false }, twitch = { at: -1e9, who: 0, twice: false };
    let nextBlink = now0 + between(1.5, 4), nextTwitch = now0 + between(2, 5);
    let time = 0, last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!shown()) return void setTimeout(() => requestAnimationFrame(frame), 250);
      const r = spot.getBoundingClientRect();
      const scale = Math.min(devicePixelRatio, 2);
      her.resize(Math.max(1, Math.round(r.width * scale)), Math.max(1, Math.round(r.height * scale)));
      time += dt;
      look.yaw += (aim.yaw - look.yaw) * Math.min(1, dt * 8);
      look.pitch += (aim.pitch - look.pitch) * Math.min(1, dt * 8);
      const t = now / 1000;
      if (t > nextBlink) {
        Object.assign(blink, { at: nextBlink, twice: Math.random() < 0.15 });
        nextBlink = t + 0.8 + between(2.5, 6);
      }
      if (t > nextTwitch) {
        Object.assign(twitch, { at: nextTwitch, who: Math.random() < 0.25 ? 2 : Math.floor(Math.random() * 2), twice: Math.random() < 0.3 });
        nextTwitch = t + 0.8 + between(3, 9);
      }
      her.pose({ time, t, look, blink, twitch });
      her.draw((layer) => send({ canvas, layer }));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  const check = () => {
    if (started || win.hidden) return;
    started = true;
    const loop = loopUrl();
    if (loop) startLoop(loop);
    else startLive();
  };
  new MutationObserver(check).observe(win, { attributes: true, attributeFilter: ['hidden'] });
  check();
}
