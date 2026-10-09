import { rgbToHex } from './settings.js';

const encode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToLinear(L, C, hue) {
  const a = C * Math.cos((hue * Math.PI) / 180), b = C * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

function oklchToSrgb(L, C, hue) {
  let rgb = oklchToLinear(L, C, hue);
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, hue))) lo = mid; else hi = mid;
    }
    rgb = oklchToLinear(L, lo, hue);
  }
  return rgb.map((c) => encode(Math.min(1, Math.max(0, c))));
}

export const GENERATORS = {
  oklch: {
    label: 'oklch ramp',
    params: {
      stops: [6, 2, 12, 1],
      dark: [0.16, 0, 0.5, 0.005],
      light: [0.975, 0.5, 1, 0.005],
      curve: [1, 0.3, 3, 0.05],
      hueStart: [275, 0, 360, 1],
      hueEnd: [205, 0, 360, 1],
      hueBend: [40, -180, 180, 1],
      chroma: [0.19, 0, 0.37, 0.005],
      chromaAt: [0.4, 0, 1, 0.01],
      chromaWidth: [0.3, 0.05, 1, 0.01],
    },
    color(p, t) {
      const L = p.dark + (p.light - p.dark) * t ** p.curve;
      const hue = p.hueStart + (p.hueEnd - p.hueStart) * t + p.hueBend * Math.sin(Math.PI * t);
      const C = p.chroma * Math.exp(-((t - p.chromaAt) ** 2) / (2 * p.chromaWidth ** 2));
      return oklchToSrgb(L, C, hue);
    },
  },
  cubehelix: {
    label: 'cubehelix',
    params: {
      stops: [6, 2, 12, 1],
      dark: [0.05, 0, 0.5, 0.01],
      light: [0.95, 0.5, 1, 0.01],
      gamma: [1, 0.3, 3, 0.05],
      start: [0.5, 0, 3, 0.05],
      rotations: [-0.3, -3, 3, 0.05],
      hue: [1.2, 0, 3, 0.05],
    },
    color(p, t) {
      const lambda = (p.dark + (p.light - p.dark) * t) ** p.gamma;
      const phi = 2 * Math.PI * (p.start / 3 + p.rotations * t);
      const amp = (p.hue * lambda * (1 - lambda)) / 2;
      const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
      return [
        lambda + amp * (-0.14861 * cos + 1.78277 * sin),
        lambda + amp * (-0.29227 * cos - 0.90649 * sin),
        lambda + amp * (1.97294 * cos),
      ].map((c) => Math.min(1, Math.max(0, c)));
    },
  },
};

export const defaultParams = (generator) =>
  Object.fromEntries(Object.entries(generator.params).map(([k, [v]]) => [k, v]));

export function generatePalette(generator, p) {
  const n = p.stops;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return { pos: +t.toFixed(4), color: rgbToHex(generator.color(p, t)) };
  });
}
