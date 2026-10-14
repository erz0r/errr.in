export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');

export const sortedStops = (palette) => [...palette].sort((a, b) => a.pos - b.pos);

export function rampAt(palette, t) {
  const stops = sortedStops(palette);
  if (t <= stops[0].pos) return hexToRgb(stops[0].color);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (t <= b.pos) {
      const k = b.pos === a.pos ? 1 : (t - a.pos) / (b.pos - a.pos);
      const [ca, cb] = [hexToRgb(a.color), hexToRgb(b.color)];
      return ca.map((c, ch) => c + k * (cb[ch] - c));
    }
  }
  return hexToRgb(stops.at(-1).color);
}

export function rampHex(palette) {
  let out = '';
  for (let i = 0; i <= 255; i++) out += rgbToHex(rampAt(palette, i / 255)).slice(1);
  return out;
}

export const grayOf = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function inkGray(s, palette = s.palette) {
  const under = luminance(rampAt(palette, grayOf(s.window.bg)));
  const readability = (gray) => contrast(luminance(rampAt(palette, gray)), under);
  const wanted = grayOf(s.window.ink);
  if (readability(wanted) >= s.minContrast) return wanted;
  let nearest = null, best = wanted, bestContrast = 0;
  for (let v = 0; v <= 255; v++) {
    const gray = v / 255, c = readability(gray);
    if (c >= s.minContrast && (nearest === null || Math.abs(gray - wanted) < Math.abs(nearest - wanted))) nearest = gray;
    if (c > bestContrast) [best, bestContrast] = [gray, c];
  }
  return nearest ?? best;
}

export function inkColor(s, palette = s.palette) {
  const gray = inkGray(s, palette);
  const window = rampAt(palette, grayOf(s.window.bg)), under = luminance(window);
  const color = rampAt(palette, gray);
  if (contrast(luminance(color), under) >= s.minContrast) return { gray, color, override: false };
  const toward = under > 0.18 ? 0 : 1;
  for (let k = 0; k <= 1.0001; k += 0.01) {
    const shade = window.map((c) => c + (toward - c) * k);
    if (contrast(luminance(shade), under) >= s.minContrast) return { gray, color: shade, override: true };
  }
  return { gray, color: [toward, toward, toward], override: true };
}

export function paletteVars(s, palette = s.palette) {
  const mapped = (gray) => rgbToHex(rampAt(palette, gray));
  const bg = grayOf(s.window.bg), ink = inkColor(s, palette);
  return {
    '--ink-gray': +ink.gray.toFixed(4),
    '--ink-color': ink.color.map((c) => +c.toFixed(4)).join(' '),
    '--ink-override': ink.override ? 1 : 0,
    '--ramp-0': mapped(0),
    '--map-bg': mapped(bg),
    '--map-ink': rgbToHex(ink.color),
    '--map-halo': mapped(s.haloGlow),
  };
}

export function cssVars(s) {
  const bg = grayOf(s.window.bg);
  const palette = Object.entries(paletteVars(s)).map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return `:root {
  --feather: ${s.feather}px;
  --edge-blur: ${s.edgeBlur}px;
  --halo-size: ${s.haloSize}px;
  --halo-glow: ${s.haloGlow};
  --stack-glow: ${s.stackGlow};
  --text-overlay: ${s.textOverlay};
  --liquid-refract: ${s.liquidRefract};
  --liquid-light: ${s.liquidLight};
  --liquid-damping: ${s.liquidDamping};
  --liquid-click: ${s.liquidClick};
  --liquid-size: ${s.liquidSize};
  --window-push: ${s.windowPush};
  --fade-ms: ${s.fadeMs};
  --fade-spread: ${s.fadeSpread};
  --fade-scale: ${s.fadeScale};
  --portal-reach: ${s.portalReach};
  --portal-blur: ${s.portalBlur};
  --dither-amount: ${s.ditherAmount};
  --dither-levels: ${s.ditherLevels};
  --dither-scale: ${s.ditherScale};
  --dither-spread: ${s.ditherSpread};
  --dither-pattern: ${s.ditherPattern};
  --model-black: ${s.modelBlack};
  --model-white: ${s.modelWhite};
  --model-gamma: ${s.modelGamma};
  --model-light: ${s.modelLight};
  --model-fill: ${s.modelFill};
  --model-x: ${s.modelX};
  --model-y: ${s.modelY};
  --model-size: ${s.modelSize};
  --model-turn: ${s.modelTurn};
  --image-black: ${s.imageBlack};
  --image-white: ${s.imageWhite};
  --image-gamma: ${s.imageGamma};
  --image-from: ${s.imageFrom};
  --image-to: ${s.imageTo};
  --image-fade-x: ${s.imageFadeX};
  --image-fade-y: ${s.imageFadeY};
  --shadow-angle: ${s.shadowAngle};
  --shadow-height: ${s.shadowHeight};
  --shadow-strength: ${s.shadowStrength};
  --inset-blur: ${s.insetBlur}px;
  --inset-tone: ${s.insetTone};
  --inset-mix: ${s.insetMix};
  --inset-ink-tone: ${s.insetInkTone};
  --inset-ink-mix: ${s.insetInkMix};
  --sect-pad-x: ${s.sectPadX};
  --sect-pad-y: ${s.sectPadY};
  --cols-split: ${s.colsSplit};
  --cols-gap: ${s.colsGap};
  --window-layout: ${s.windowLayout};
  --bg-gray: ${+bg.toFixed(4)};
${palette}
}`;
}

const RANGES = {
  feather: [0, 200, 40],
  edgeBlur: [0, 100, 10],
  haloSize: [0, 300, 40],
  haloGlow: [0, 1, 0.55],
  stackGlow: [0, 1, 0.25],
  textOverlay: [0, 1, 1],
  liquidRefract: [0, 60, 10],
  liquidLight: [0, 1, 0.12],
  liquidDamping: [0.9, 0.999, 0.985],
  liquidClick: [0, 2, 1],
  liquidSize: [2, 80, 16],
  fadeMs: [0, 2000, 400],
  fadeSpread: [0, 0.95, 0.6],
  fadeScale: [40, 1000, 320],
  portalReach: [0, 120, 18],
  portalBlur: [0, 40, 4],
  ditherAmount: [0, 1, 0],
  ditherLevels: [2, 32, 4],
  ditherScale: [1, 8, 2],
  ditherSpread: [0, 1, 1],
  modelBlack: [0, 1, 0],
  modelWhite: [0, 1, 1],
  modelGamma: [0.2, 3, 1],
  modelLight: [0, 6, 1.3],
  modelFill: [0, 4, 0.5],
  modelX: [-900, 900, 0],
  modelY: [-900, 900, 0],
  modelSize: [0.3, 2.5, 1],
  modelTurn: [-180, 180, -34],
  imageBlack: [0, 1, 0],
  imageWhite: [0, 1, 1],
  imageGamma: [0.2, 3, 1],
  imageFrom: [0, 1, 0],
  imageTo: [0, 1, 1],
  imageFadeX: [0, 200, 28],
  imageFadeY: [0, 200, 12],
  shadowAngle: [-180, 180, 51],
  shadowHeight: [5, 85, 39],
  shadowStrength: [0, 1, 1],
  insetBlur: [0, 40, 10],
  insetTone: [0, 1, 0.3],
  insetMix: [0, 1, 1],
  insetInkTone: [0, 1, 1],
  insetInkMix: [0, 1, 0],
  sectPadX: [0, 80, 18],
  sectPadY: [0, 80, 14],
  colsSplit: [0.15, 0.85, 0.33],
  colsGap: [0, 120, 53],
  minContrast: [1, 12, 4.5],
  windowPush: [0, 2, 1],
};
const CHOICES = {
  windowLayout: [['swap', 'pack', 'stack'], 'swap'],
  ditherPattern: [['bayer2', 'bayer4', 'bayer8', 'noise', 'lines', 'diagonal'], 'bayer4'],
};
const HEX = /^#[0-9a-f]{6}$/i;

export function validatePalette(palette) {
  if (!Array.isArray(palette) || palette.length < 2 || palette.length > 32) {
    throw new Error('palette needs 2 to 32 stops');
  }
  return palette.map((stop) => {
    if (typeof stop?.pos !== 'number' || !(stop.pos >= 0 && stop.pos <= 1) || !HEX.test(stop?.color)) {
      throw new Error('each palette stop needs pos 0..1 and color #rrggbb');
    }
    return { pos: stop.pos, color: stop.color.toLowerCase() };
  });
}

export function validate(s) {
  const out = {};
  for (const [key, [lo, hi, fallback]] of Object.entries(RANGES)) {
    const v = s?.[key] ?? fallback;
    if (typeof v !== 'number' || !(v >= lo && v <= hi)) throw new Error(`${key} must be a number from ${lo} to ${hi}`);
    out[key] = v;
  }
  for (const [key, [allowed, fallback]] of Object.entries(CHOICES)) {
    const v = s?.[key] ?? fallback;
    if (!allowed.includes(v)) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
    out[key] = v;
  }
  out.palette = validatePalette(s.palette);
  if (!HEX.test(s.window?.bg) || !HEX.test(s.window?.ink)) throw new Error('window.bg and window.ink must be #rrggbb');
  out.window = { bg: s.window.bg.toLowerCase(), ink: s.window.ink.toLowerCase() };
  return out;
}

export const formatSettings = (s) => JSON.stringify(validate(s), null, 2)
  .replace(/\{\s+("pos": [^,]+),\s+("color": "[^"]+")\s+\}/g, '{ $1, $2 }')
  .replace(/\{\s+("bg": "[^"]+"),\s+("ink": "[^"]+")\s+\}/, '{ $1, $2 }') + '\n';
