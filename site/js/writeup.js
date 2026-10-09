(() => {
  const originals = new WeakMap();

  function readRamp() {
    const hex = document.documentElement.dataset.ramp;
    const ramp = new Uint8Array(256 * 3);
    for (let i = 0; i < ramp.length; i++) ramp[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return ramp;
  }

  async function recolor(img, ramp) {
    if (!originals.has(img)) originals.set(img, img.currentSrc || img.src);
    const source = new Image();
    source.src = originals.get(img);
    try {
      await source.decode();
      const k = Math.min(1, (img.parentElement.clientWidth * devicePixelRatio) / source.naturalWidth);
      const [w, h] = [Math.max(1, Math.round(source.naturalWidth * k)), Math.max(1, Math.round(source.naturalHeight * k))];
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [w, h];
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(source, 0, 0, w, h);
      const pixels = ctx.getImageData(0, 0, w, h);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 3;
        d[i] = ramp[g];
        d[i + 1] = ramp[g + 1];
        d[i + 2] = ramp[g + 2];
      }
      ctx.putImageData(pixels, 0, 0);
      const url = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve)));
      if (img.dataset.mapped?.startsWith('blob:')) URL.revokeObjectURL(img.dataset.mapped);
      img.width ||= source.naturalWidth;
      img.src = url;
      img.dataset.mapped = url;
    } catch (err) {
      console.warn('Could not recolor image (cross-origin?); showing it as is.', img, err);
      img.dataset.mapped = 'original';
    }
  }

  const recolorAll = () => {
    const ramp = readRamp();
    document.querySelectorAll('.article img').forEach((img) => recolor(img, ramp));
  };
  recolorAll();
  addEventListener('tune:apply', recolorAll);
})();
