(() => {
  const SIZE = 64;
  const root = document.documentElement;
  const tag = (selector, attrs) => document.querySelector(selector)
    ?? document.head.appendChild(Object.assign(document.createElement(attrs.tag), attrs.props));
  const icon = tag('link[rel="icon"]', { tag: 'link', props: { rel: 'icon' } });
  const bar = tag('meta[name="theme-color"]', { tag: 'meta', props: { name: 'theme-color' } });

  function draw() {
    const hex = root.dataset.ramp;
    if (!hex) return;
    const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2) / (SIZE / 2);
        const t = Math.min(1, Math.max(0, (r - 0.45) / 0.55));
        const alpha = 1 - t * t * (3 - 2 * t);
        const i = Math.round(255 * Math.max(0, 1 - r)) * 6, p = (y * SIZE + x) * 4;
        for (let c = 0; c < 3; c++) image.data[p + c] = parseInt(hex.slice(i + c * 2, i + c * 2 + 2), 16);
        image.data[p + 3] = Math.round(255 * alpha);
      }
    }
    ctx.putImageData(image, 0, 0);
    icon.type = 'image/png';
    icon.href = canvas.toDataURL('image/png');
    bar.content = `#${hex.slice(0, 6)}`;
  }

  draw();
  addEventListener('tune:apply', draw);
})();
