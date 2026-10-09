import { deflateSync, crc32 } from 'node:zlib';
import { rampHex } from './tune/settings.js';

function png(width, height, rgba) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function circlePng(palette, width, height, diameter, { opaque = false } = {}) {
  const hex = rampHex(palette);
  const color = (i) => [0, 1, 2].map((c) => parseInt(hex.slice(i * 6 + c * 2, i * 6 + c * 2 + 2), 16));
  const page = color(0);
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) / (diameter / 2);
      const t = Math.min(1, Math.max(0, (r - 0.45) / 0.55));
      const alpha = 1 - t * t * (3 - 2 * t);
      const c = color(Math.round(255 * Math.max(0, 1 - Math.min(r, 1)))), p = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) rgba[p + k] = opaque ? Math.round(page[k] + (c[k] - page[k]) * alpha) : c[k];
      rgba[p + 3] = opaque ? 255 : Math.round(255 * alpha);
    }
  }
  return png(width, height, rgba);
}

export const ICONS = {
  '/favicon.png': (palette) => circlePng(palette, 64, 64, 64),
  '/favicon.ico': (palette) => circlePng(palette, 64, 64, 64),
  '/apple-touch-icon.png': (palette) => circlePng(palette, 180, 180, 180, { opaque: true }),
};
