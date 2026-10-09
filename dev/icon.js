import { deflateSync, crc32 } from 'node:zlib';
import { rampHex } from './tune/settings.js';

function png(size, rgba) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function iconPng(palette, size, { opaque = false } = {}) {
  const hex = rampHex(palette);
  const color = (i) => [0, 1, 2].map((c) => parseInt(hex.slice(i * 6 + c * 2, i * 6 + c * 2 + 2), 16));
  const page = color(0);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const t = Math.min(1, Math.max(0, (r - 0.45) / 0.55));
      const alpha = 1 - t * t * (3 - 2 * t);
      const c = color(Math.round(255 * Math.max(0, 1 - r))), p = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) rgba[p + k] = opaque ? Math.round(page[k] + (c[k] - page[k]) * alpha) : c[k];
      rgba[p + 3] = opaque ? 255 : Math.round(255 * alpha);
    }
  }
  return png(size, rgba);
}

export const ICONS = {
  '/favicon.png': (palette) => iconPng(palette, 64),
  '/favicon.ico': (palette) => iconPng(palette, 64),
  '/apple-touch-icon.png': (palette) => iconPng(palette, 180, { opaque: true }),
};
