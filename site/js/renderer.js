(() => {
  const root = document.documentElement;
  const stage = document.querySelector('.stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'gl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const scaleParam = Number(new URLSearchParams(location.search).get('scale')) || 0;

  const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const BLUR = `
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uSize, uDir;
uniform float uSigma;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -16; i <= 16; i++) {
    float x = float(i) * uSigma * 0.1875;
    float w = exp(-0.5 * (x / uSigma) * (x / uSigma));
    sum += texture2D(uSrc, uv + uDir * x / uSize) * w;
    total += w;
  }
  gl_FragColor = sum / total;
}`;

  const ENCODING = `
float dec(vec2 e) { return (floor(e.x * 255.0 + 0.5) * 256.0 + floor(e.y * 255.0 + 0.5)) / 65535.0 * 2.0 - 1.0; }
vec2 enc(float h) {
  float v = floor(clamp(h * 0.5 + 0.5, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}`;

  const LIQUID_STEP = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;
uniform float uDamping;
uniform vec4 uDrops[4];
${ENCODING}
float at(vec2 c) { return dec(texture2D(uState, c / uGrid).rg); }
float bump(float d, float radius) { radius = max(radius, 1.0); return exp(-d * d / (radius * radius)); }
void main() {
  vec2 c = gl_FragCoord.xy;
  vec4 s = texture2D(uState, c / uGrid);
  float next = (at(c + vec2(1.0, 0.0)) + at(c - vec2(1.0, 0.0)) + at(c + vec2(0.0, 1.0)) + at(c - vec2(0.0, 1.0))) * 0.5 - dec(s.ba);
  next *= uDamping;
  for (int i = 0; i < 4; i++) next -= uDrops[i].w * bump(length(c - uDrops[i].xy), uDrops[i].z);
  gl_FragColor = vec4(enc(next), s.rg);
}`;

  const LIQUID_SURFACE = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;
${ENCODING}
float at(vec2 c) { return dec(texture2D(uState, c / uGrid).rg); }
void main() {
  vec2 c = gl_FragCoord.xy;
  vec2 slope = vec2(at(c + vec2(1.0, 0.0)) - at(c - vec2(1.0, 0.0)), at(c + vec2(0.0, 1.0)) - at(c - vec2(0.0, 1.0)));
  gl_FragColor = vec4((clamp(vec3(at(c), slope), -1.0, 1.0) * 127.0 + 128.0) / 255.0, 1.0);
}`;

  const MAIN = (max) => `
precision highp float;
#define MAX ${max}
uniform vec2 uSize;
uniform float uScale;
uniform vec4 uRect[MAX];
uniform vec4 uArea[MAX];
uniform float uAlpha[MAX];
uniform vec4 uFade[MAX];
uniform float uSpread, uNoiseScale, uPortalReach, uPortalBlur;
uniform vec4 uTail;
uniform sampler2D uModel, uModelShadow;
uniform float uShadowGray;
uniform vec4 uModelRect;
uniform float uModelWin;
uniform vec3 uModelLevels;
uniform float uDither, uDitherLevels, uDitherScale, uDitherSpread, uDitherPattern;
uniform int uCount;
uniform float uFeather, uBlur, uHaloSize, uHaloGlow, uStackGlow, uOverlay;
uniform float uBg, uInk, uMapOn;
uniform vec3 uInkColor;
uniform float uInkOverride;
uniform sampler2D uRamp, uText, uTextSoft, uMedia, uMediaSoft;
uniform sampler2D uSurface;
uniform vec2 uLiquidSize;
uniform float uRefract, uLight;
const vec3 GRAY = vec3(0.2126, 0.7152, 0.0722);

float erf(float x) {
  float a = abs(x), t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return sign(x) * y;
}
float blurSpan(float x, float a, float b, float s) {
  if (s < 0.01) return step(a, x) * step(x, b);
  float k = 0.70710678 / s;
  return 0.5 * (erf((b - x) * k) - erf((a - x) * k));
}
float cssFade(float d, float len, float f) {
  if (d < 0.0 || d > len) return 0.0;
  if (f <= 0.0) return 1.0;
  if (d <= f) return d / f;
  float s2 = max(f, len - f);
  if (d <= s2) return 1.0;
  return (len - d) / (len - s2);
}
float gaussian(float x, float s) { return exp(-(x * x) / (2.0 * s * s)) / (2.5066283 * s); }
float shadowX(float x, float y, float s, float corner, vec2 halfSize) {
  float delta = min(halfSize.y - corner - abs(y), 0.0);
  float curved = halfSize.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
  float k = 0.70710678 / s;
  return 0.5 * (erf((x + curved) * k) - erf((x - curved) * k));
}
float roundedBlur(vec2 lo, vec2 hi, vec2 p, float s, float corner) {
  vec2 halfSize = (hi - lo) * 0.5;
  p -= (lo + hi) * 0.5;
  corner = min(corner, min(halfSize.x, halfSize.y));
  float start = clamp(-3.0 * s, p.y - halfSize.y, p.y + halfSize.y);
  float end = clamp(3.0 * s, p.y - halfSize.y, p.y + halfSize.y);
  float stepY = (end - start) / 4.0, y = start + stepY * 0.5, v = 0.0;
  for (int i = 0; i < 4; i++) {
    v += shadowX(p.x, p.y - y, s, corner, halfSize) * gaussian(y, s) * stepY;
    y += stepY;
  }
  return v;
}

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float threshold(vec2 cell) {
  if (uDitherPattern < 0.5) return bayer2(cell);
  if (uDitherPattern < 1.5) return bayer4(cell);
  if (uDitherPattern < 2.5) return bayer8(cell);
  if (uDitherPattern < 3.5) return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  if (uDitherPattern < 4.5) return mod(cell.y, 4.0) / 4.0;
  return mod(cell.x + cell.y, 4.0) / 4.0;
}
float quantize(float v, float t) {
  float steps = max(uDitherLevels - 1.0, 1.0);
  return clamp(floor(v * steps + mix(0.5, t, uDitherSpread)) / steps, 0.0, 1.0);
}

bool isPopup(vec4 f) { return mod(floor(f.w / 2.0), 2.0) > 0.5; }

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float k = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), k * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(q1, q1), k * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(q2, q2), k * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float bubbleBody(vec2 p, vec4 r) {
  vec2 hb = (r.zw - r.xy) * 0.5;
  return sdRoundBox(p - (r.xy + r.zw) * 0.5, hb, min(12.0, min(hb.x, hb.y)));
}
float tailShape(vec2 p, vec4 r) {
  if (uTail.w <= uTail.z) return 1e5;
  return sdTriangle(p, vec2(uTail.z, r.w - 6.0), vec2(uTail.w, r.w - 6.0), uTail.xy);
}
float bubble(vec2 p, vec4 r) {
  return smin(bubbleBody(p, r), tailShape(p, r), 5.0);
}
float tailFade(vec2 p, float from, float to) {
  if (uTail.w <= uTail.z) return 1.0;
  return smoothstep(from, to, uTail.y - p.y);
}
float tailTaper(vec2 p, vec4 r, float from, float to) {
  if (uTail.w <= uTail.z) return 1.0;
  float dx = max(min(uTail.x, uTail.z) - p.x, max(p.x - uTail.w, 0.0));
  float column = 1.0 - smoothstep(0.0, 12.0, dx);
  return mix(1.0, tailFade(p, from, to), column);
}
float softEdge(float sd, float offset, float sigma) {
  return 0.5 * (1.0 - erf((sd - offset) * 0.70710678 / sigma));
}
float bubbleEdge(vec2 p, vec4 r, float offset, float sigma) {
  return max(softEdge(bubbleBody(p, r), offset, sigma) * tailTaper(p, r, 8.0, 44.0),
             softEdge(tailShape(p, r), offset, sigma) * tailFade(p, 8.0, 44.0));
}

float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q) {
  vec2 i = floor(q), f = fract(q), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fadeAt(float a, vec2 p, vec4 rect, vec4 pattern) {
  if (a >= 1.0 || uSpread <= 0.0) return a;
  vec2 q = (p + pattern.xy) / uNoiseScale;
  float n = 0.7 * noise(q) + 0.3 * noise(q * 2.13 + 19.7);
  vec2 center = (rect.xy + rect.zw) * 0.5, size = max(rect.zw - rect.xy, vec2(1.0));
  float sweep = 0.5 + dot((p - center) / size, vec2(cos(pattern.z), sin(pattern.z)));
  float turn = clamp(mix(n, sweep, 0.4), 0.0, 1.0);
  if (mod(pattern.w, 2.0) > 0.5) turn = 1.0 - turn;
  return smoothstep(0.0, 1.0, (a - turn * uSpread) / (1.0 - uSpread));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y * uScale - gl_FragCoord.y) / uScale;
  vec4 water = (texture2D(uSurface, vec2(p.x, uLiquidSize.y - p.y) / uLiquidSize) * 255.0 - 128.0) / 127.0;
  p += vec2(water.y, -water.z) * uRefract;
  float e = uHaloSize * 0.6, s = max(uHaloSize, 0.5), reach = e + 3.0 * s;
  float halo[MAX], alpha[MAX];
  float g = 0.0;
  float ink = 0.0;
  float shade = 0.0;
  vec2 mu = (p - uModelRect.xy) / max(uModelRect.zw - uModelRect.xy, vec2(1.0));
  vec4 mm = texture2D(uModel, clamp(mu, 0.0, 1.0));
  float sa = texture2D(uModelShadow, clamp(mu, 0.0, 1.0)).a * step(0.0, mu.x) * step(mu.x, 1.0) * step(0.0, mu.y) * step(mu.y, 1.0);
  mm *= step(0.0, mu.x) * step(mu.x, 1.0) * step(0.0, mu.y) * step(mu.y, 1.0);
  float mg = mm.a > 0.001 ? dot(mm.rgb / mm.a, GRAY) : 0.0;
  mg = pow(clamp((mg - uModelLevels.x) / max(uModelLevels.y - uModelLevels.x, 0.001), 0.0, 1.0), 1.0 / max(uModelLevels.z, 0.01));

  for (int i = 0; i < MAX; i++) {
    halo[i] = 0.0;
    vec4 r = uRect[i];
    alpha[i] = i < uCount ? fadeAt(uAlpha[i], p, r, uFade[i]) : 0.0;
    if (i < uCount && p.x > r.x - reach && p.x < r.z + reach && p.y > r.y - reach && p.y < r.w + reach) {
      if (isPopup(uFade[i])) {
        float hs = min(s, 8.0);
        halo[i] = alpha[i] * uHaloGlow * bubbleEdge(p, r, 0.6 * hs, hs);
      } else {
        halo[i] = alpha[i] * uHaloGlow * roundedBlur(r.xy - e, r.zw + e, p, s, 24.0);
      }
      g += (1.0 - g) * halo[i];
    }
  }

  for (int i = 0; i < MAX; i++) {
    vec4 r = uRect[i];
    vec2 size = max(r.zw - r.xy, vec2(1.0)), d = p - r.xy;
    vec2 uv = mix(uArea[i].xy, uArea[i].zw, clamp(d / size, 0.0, 1.0));
    vec4 t = texture2D(uText, uv), ts = texture2D(uTextSoft, uv);
    vec4 m = texture2D(uMedia, uv), ms = texture2D(uMediaSoft, uv);
    if (i < uCount) {
      float glow = uStackGlow, feather = uFeather, sd = 0.0;
      bool popup = isPopup(uFade[i]);
      if (popup) {
        feather = mix(20.0, min(uFeather, 4.0), tailTaper(p, r, 8.0, 44.0));
        sd = bubble(p, r);
        float clear = alpha[i] * bubbleEdge(p, r, uPortalReach, max(uPortalBlur, 0.5));
        g *= 1.0 - clear;
        ink *= 1.0 - clear;
        shade *= 1.0 - clear;
        glow = 1.0;
      }
      g += (1.0 - g) * halo[i] * glow;
      ink *= 1.0 - halo[i] * glow;
      shade *= 1.0 - halo[i] * glow;
      float inRect = step(0.0, d.x) * step(0.0, d.y) * step(d.x, size.x) * step(d.y, size.y);
      if (popup ? sd < 0.0 : inRect > 0.5) {
        t *= inRect; ts *= inRect; m *= inRect; ms *= inRect;
        float tip = popup ? tailTaper(p, r, 0.0, 36.0) : 1.0;
        float fade = (popup ? clamp(-sd / max(feather, 0.5), 0.0, 1.0) * tip : cssFade(d.x, size.x, feather) * cssFade(d.y, size.y, feather)) * alpha[i];
        float cover = popup ? 1.0 : blurSpan(p.x, r.x, r.z, uBlur) * blurSpan(p.y, r.y, r.w, uBlur);
        float soft = cover * uBg + dot(ms.rgb, GRAY) - ms.a * uBg + ts.r * (uInk - uBg);
        g = g * (1.0 - cover * fade) + soft * fade;
        ink *= 1.0 - cover * fade;
        shade *= 1.0 - cover * fade;
        float sharp = (popup ? clamp(-sd / max(2.0 * feather, 0.5), 0.0, 1.0) * tip : cssFade(d.x, size.x, 2.0 * feather) * cssFade(d.y, size.y, 2.0 * feather)) * alpha[i];
        float content = uBg * (1.0 - m.a) + dot(m.rgb, GRAY);
        content = mix(content, uInk, t.r);
        g = mix(g, content, sharp);
        ink = mix(ink, t.r, sharp);
        shade *= 1.0 - sharp;
        if (abs(float(i) - uModelWin) < 0.5) {
          g = mix(g, uShadowGray, sa * fade);
          ink *= 1.0 - sa * fade;
          shade = mix(shade, 1.0, sa * fade);
          g = mix(g, mg, mm.a * fade);
          shade *= 1.0 - mm.a * fade;
          ink *= 1.0 - mm.a * fade;
        }
        g = mix(g, uInk, t.r * uOverlay * alpha[i]);
        ink = mix(ink, 1.0, t.r * uOverlay * alpha[i]);
        shade *= 1.0 - t.r * uOverlay * alpha[i];
      }
    }
  }

  g = clamp(g + water.x * uLight, 0.0, 1.0);
  if (uDither > 0.0) g = mix(g, quantize(g, threshold(floor(gl_FragCoord.xy / (max(uDitherScale, 1.0) * uScale)))), uDither);
  vec3 color = uMapOn > 0.5 ? texture2D(uRamp, vec2((g * 255.0 + 0.5) / 256.0, 0.5)).rgb : vec3(g);
  if (uMapOn > 0.5) color = mix(color, uInkColor, ink * uInkOverride);
  if (uMapOn > 0.5) color = mix(color, texture2D(uRamp, vec2((uShadowGray * 255.0 + 0.5) / 256.0, 0.5)).rgb, shade);
  gl_FragColor = vec4(color, 1.0);
}`;

  const MAIN_UNIFORMS = ['uSize', 'uScale', 'uRect', 'uArea', 'uCount', 'uFeather', 'uBlur', 'uHaloSize',
    'uHaloGlow', 'uStackGlow', 'uOverlay', 'uBg', 'uInk', 'uMapOn',
    'uInkColor', 'uInkOverride', 'uAlpha', 'uFade', 'uSpread', 'uNoiseScale', 'uPortalReach', 'uPortalBlur', 'uTail', 'uDither', 'uDitherLevels', 'uDitherScale', 'uDitherSpread', 'uDitherPattern', 'uModel', 'uModelShadow', 'uShadowGray', 'uModelRect', 'uModelWin', 'uModelLevels', 'uRamp', 'uText', 'uTextSoft', 'uMedia', 'uMediaSoft', 'uSurface', 'uLiquidSize', 'uRefract', 'uLight'];
  const UNITS = { uRamp: 0, uText: 1, uTextSoft: 2, uMedia: 3, uMediaSoft: 4, uSurface: 5, uModel: 6, uModelShadow: 7 };

  let gl = null;
  let blurProgram = null;
  let main = null;
  let maxCapacity = 0;
  let rampTex = null;
  let atlas = null;
  let atlasDirty = true;
  let stepProgram = null, surfaceProgram = null;
  const model = { tex: null, shadow: null, spot: null };
  let liquid = null;
  let stillWater = null;

  function compile(fragment, uniforms) {
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const uniform = {};
    for (const name of uniforms) {
      uniform[name] = gl.getUniformLocation(program, ['uRect', 'uArea', 'uAlpha', 'uFade', 'uDrops'].includes(name) ? `${name}[0]` : name);
    }
    return { program, uniform };
  }

  function buildMain(count) {
    let capacity = 4;
    while (capacity < count && capacity < maxCapacity) capacity *= 2;
    capacity = Math.min(capacity, maxCapacity);
    if (main?.capacity === capacity) return;
    if (main) gl.deleteProgram(main.program);
    main = { ...compile(MAIN(capacity), MAIN_UNIFORMS), capacity };
    gl.useProgram(main.program);
    for (const [name, unit] of Object.entries(UNITS)) gl.uniform1i(main.uniform[name], unit);
  }

  function newTexture(width, height, source = null, filter = gl.LINEAR) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (source instanceof HTMLCanvasElement) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    return tex;
  }

  function init() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return false;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      maxCapacity = Math.min(64, Math.floor((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 20) / 4));
      blurProgram = compile(BLUR, ['uSrc', 'uSize', 'uDir', 'uSigma']);
      stepProgram = compile(LIQUID_STEP, ['uState', 'uGrid', 'uDamping', 'uDrops']);
      surfaceProgram = compile(LIQUID_SURFACE, ['uState', 'uGrid']);
      stillWater = newTexture(1, 1, new Uint8Array([128, 128, 128, 255]));
      liquid = null;
      main = null;
      buildMain(1);
      rampTex = null;
      atlas = null;
      atlasDirty = true;
      readSettings();
      root.classList.add('gl');
      return true;
    } catch (err) {
      console.warn('WebGL renderer unavailable, using the flat fallback:', err);
      gl = null;
      return false;
    }
  }

  let settings = null;
  function readSettings() {
    const css = getComputedStyle(root);
    const num = (name) => parseFloat(css.getPropertyValue(name));
    settings = {
      feather: num('--feather'), blur: num('--edge-blur'), haloSize: num('--halo-size'),
      haloGlow: num('--halo-glow'), stackGlow: num('--stack-glow'), overlay: num('--text-overlay'),
      bg: num('--bg-gray'), ink: num('--ink-gray'),
      inkColor: css.getPropertyValue('--ink-color').trim().split(/\s+/).map(Number), inkOverride: num('--ink-override'),
      spread: num('--fade-spread'), noiseScale: num('--fade-scale') || 320,
      portalReach: num('--portal-reach'), portalBlur: num('--portal-blur'),
      dither: num('--dither-amount') || 0, ditherLevels: num('--dither-levels') || 4, ditherScale: num('--dither-scale') || 2,
      ditherSpread: num('--dither-spread'),
      modelLevels: [num('--model-black') || 0, Number.isNaN(num('--model-white')) ? 1 : num('--model-white'), num('--model-gamma') || 1],
      ditherPattern: Math.max(0, ['bayer2', 'bayer4', 'bayer8', 'noise', 'lines', 'diagonal'].indexOf(css.getPropertyValue('--dither-pattern').trim())),
      refract: num('--liquid-refract'), light: num('--liquid-light'), damping: num('--liquid-damping'),
      click: num('--liquid-click'), splash: num('--liquid-size'),
    };
    const hex = root.dataset.ramp;
    const ramp = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) ramp[i * 4 + c] = parseInt(hex.slice(i * 6 + c * 2, i * 6 + c * 2 + 2), 16);
      ramp[i * 4 + 3] = 255;
    }
    let darkest = 0, least = Infinity;
    for (let i = 0; i < 256; i++) {
      const l = 0.2126 * ramp[i * 4] + 0.7152 * ramp[i * 4 + 1] + 0.0722 * ramp[i * 4 + 2];
      if (l < least) [least, darkest] = [l, i];
    }
    settings.shadowGray = darkest / 255;
    if (rampTex) gl.deleteTexture(rampTex);
    rampTex = newTexture(256, 1, ramp);
  }

  const rasters = new Map();

  function drawImage(ctx, img) {
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    if (fit !== 'contain' && fit !== 'cover') return ctx.drawImage(img, r.left, r.top, r.width, r.height);
    const k = (fit === 'cover' ? Math.max : Math.min)(r.width / img.naturalWidth, r.height / img.naturalHeight);
    const [w, h] = [img.naturalWidth * k, img.naturalHeight * k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.width, r.height);
    ctx.clip();
    ctx.drawImage(img, r.left + (r.width - w) / 2, r.top + (r.height - h) / 2, w, h);
    ctx.restore();
  }

  function rasterize(win) {
    const box = win.getBoundingClientRect();
    const scale = devicePixelRatio;
    const surface = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(box.width * scale));
      c.height = Math.max(1, Math.round(box.height * scale));
      const ctx = c.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, -box.left * scale, -box.top * scale);
      return [c, ctx];
    };

    const [text, ctx] = surface();
    ctx.fillStyle = '#f00';
    const range = document.createRange();
    const walker = document.createTreeWalker(win, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      const cs = getComputedStyle(node.parentElement);
      if (cs.visibility === 'hidden' || !node.textContent.trim()) continue;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
      const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
      const shown = (t) => cs.textTransform === 'uppercase' ? t.toUpperCase()
        : cs.textTransform === 'lowercase' ? t.toLowerCase()
          : cs.textTransform === 'capitalize' ? t.replace(/^\p{L}/u, (c) => c.toUpperCase()) : t;
      for (const word of node.textContent.matchAll(/\S+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        const rects = range.getClientRects();
        if (rects.length === 1) {
          ctx.fillText(shown(word[0]), rects[0].left, rects[0].top + ascent);
          continue;
        }
        for (let i = 0; i < word[0].length; i++) {
          range.setStart(node, word.index + i);
          range.setEnd(node, word.index + i + 1);
          const r = range.getClientRects()[0];
          if (r) ctx.fillText(shown(word[0][i]), r.left, r.top + ascent);
        }
      }
      if (cs.textDecorationLine.includes('underline')) {
        const thickness = Math.max(1, parseFloat(cs.fontSize) / 14);
        const text = node.textContent;
        range.setStart(node, text.search(/\S/));
        range.setEnd(node, text.trimEnd().length);
        for (const r of range.getClientRects()) ctx.fillRect(r.left, r.top + ascent + thickness * 1.5, r.width, thickness);
      }
    }
    ctx.strokeStyle = '#f00';
    for (const li of win.querySelectorAll('li')) {
      const cs = getComputedStyle(li), list = li.parentElement;
      if (cs.display !== 'list-item' || cs.listStyleType === 'none' || cs.visibility === 'hidden') continue;
      const index = [...list.children].filter((c) => c.tagName === 'LI').indexOf(li);
      const marker = list.tagName === 'OL' ? `${(list.start || 1) + index}.` : '•';
      const firstText = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
      }).nextNode();
      if (!firstText) continue;
      range.selectNodeContents(firstText);
      const line = range.getClientRects()[0];
      if (!line) continue;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
      const x = li.getBoundingClientRect().left - parseFloat(cs.fontSize) * 0.4 - ctx.measureText(marker).width;
      ctx.fillText(marker, x, line.top + ascent);
    }

    if (win.hasAttribute('data-fading')) {
      for (const area of win.querySelectorAll('textarea')) {
        const r = area.getBoundingClientRect(), cs = getComputedStyle(area);
        const size = parseFloat(cs.fontSize), lineHeight = parseFloat(cs.lineHeight) || size * 1.6;
        const [top, right, , left] = ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(cs[`padding${side}`]));
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(r.left, r.top, r.width, r.height, parseFloat(cs.borderTopLeftRadius) || 0);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.08)';
        ctx.fill();
        ctx.clip();
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.fillStyle = area.value ? '#f00' : 'rgba(255, 0, 0, 0.45)';
        const ascent = ctx.measureText('Hg').fontBoundingBoxAscent;
        const width = r.width - left - right;
        let y = r.top + top - area.scrollTop + (lineHeight - size) / 2;
        for (const paragraph of (area.value || area.placeholder).split('\n')) {
          let line = '';
          for (const word of paragraph.split(' ')) {
            const next = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(next).width > width) {
              ctx.fillText(line, r.left + left, y + ascent);
              y += lineHeight;
              line = word;
            } else {
              line = next;
            }
          }
          ctx.fillText(line, r.left + left, y + ascent);
          y += lineHeight;
        }
        ctx.restore();
      }
    }

    for (const svg of win.querySelectorAll('svg.icon')) {
      const r = svg.getBoundingClientRect();
      if (!r.width) continue;
      const box = svg.viewBox.baseVal;
      ctx.save();
      ctx.translate(r.left, r.top);
      ctx.scale(r.width / box.width, r.height / box.height);
      ctx.translate(-box.x, -box.y);
      for (const path of svg.querySelectorAll('path')) ctx.fill(new Path2D(path.getAttribute('d')));
      ctx.restore();
    }

    for (const svg of win.querySelectorAll('button svg')) {
      const r = svg.getBoundingClientRect();
      if (!r.width) continue;
      const k = r.width / svg.viewBox.baseVal.width;
      ctx.save();
      ctx.translate(r.left, r.top);
      ctx.scale(k, k);
      ctx.lineWidth = parseFloat(getComputedStyle(svg).strokeWidth) || 1.5;
      for (const path of svg.querySelectorAll('path')) ctx.stroke(new Path2D(path.getAttribute('d')));
      ctx.restore();
    }

    let media = null;
    const images = [...win.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth);
    if (images.length) {
      const [c, mctx] = surface();
      images.forEach((img) => drawImage(mctx, img));
      try {
        mctx.getImageData(0, 0, 1, 1);
        media = c;
      } catch {
        console.warn('Skipping cross-origin images in a window; they would block WebGL.', win);
      }
    }
    rasters.set(win, { text, media });
    atlasDirty = true;
  }

  function forget(win) {
    if (rasters.delete(win)) atlasDirty = true;
  }

  function blurred(src, width, height, sigma) {
    const pass = (from, dir) => {
      const out = newTexture(width, height);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
      gl.viewport(0, 0, width, height);
      gl.useProgram(blurProgram.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from);
      gl.uniform1i(blurProgram.uniform.uSrc, 0);
      gl.uniform2f(blurProgram.uniform.uSize, width, height);
      gl.uniform2f(blurProgram.uniform.uDir, ...dir);
      gl.uniform1f(blurProgram.uniform.uSigma, sigma);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      return out;
    };
    const across = pass(src, [1, 0]);
    const result = pass(across, [0, 1]);
    gl.deleteTexture(across);
    return result;
  }

  function buildAtlas() {
    if (atlas) for (const tex of new Set([atlas.text, atlas.textSoft, atlas.media, atlas.mediaSoft])) gl.deleteTexture(tex);
    const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096);
    const sigma = settings.blur * devicePixelRatio;
    const pad = Math.ceil(3 * sigma) + 1;
    const spots = [];
    let x = 0, y = 0, rowHeight = 0, width = 1;
    for (const [win, r] of rasters) {
      const [w, h] = [r.text.width + 2 * pad, r.text.height + 2 * pad];
      if (w > limit) continue;
      if (x + w > limit) [x, y, rowHeight] = [0, y + rowHeight, 0];
      if (y + h > limit) break;
      spots.push([win, r, x + pad, y + pad]);
      x += w;
      rowHeight = Math.max(rowHeight, h);
      width = Math.max(width, x);
    }
    const height = Math.max(1, y + rowHeight);
    const sheet = () => {
      const c = document.createElement('canvas');
      [c.width, c.height] = [width, height];
      return [c, c.getContext('2d')];
    };
    const [textSheet, textCtx] = sheet();
    const hasMedia = spots.some(([, r]) => r.media);
    const [mediaSheet, mediaCtx] = hasMedia ? sheet() : [null, null];
    const areas = new Map();
    for (const [win, r, left, top] of spots) {
      textCtx.drawImage(r.text, left, top);
      if (r.media) mediaCtx.drawImage(r.media, left, top);
      areas.set(win, [left / width, top / height, (left + r.text.width) / width, (top + r.text.height) / height]);
    }
    const text = newTexture(width, height, textSheet);
    const media = hasMedia ? newTexture(width, height, mediaSheet) : newTexture(1, 1, new Uint8Array(4));
    const soft = sigma >= 0.5;
    atlas = {
      text,
      textSoft: soft ? blurred(text, width, height, sigma) : text,
      media,
      mediaSoft: soft && hasMedia ? blurred(media, width, height, sigma) : media,
      areas,
      blur: settings.blur,
    };
    atlasDirty = false;
  }

  const CELL = 4;
  const STEP_MS = 1000 / 60;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const splashes = [];
  let lastSplash = -Infinity;
  const liquidOn = () => !reducedMotion.matches && (settings.refract > 0 || settings.light > 0);

  function renderInto(tex, width, height, program, setUniforms) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    setUniforms(program.uniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
  }

  function clearTexture(tex, rgba) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(...rgba);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
  }
  const FLAT_STATE = [128 / 255, 0, 128 / 255, 0];

  function ensureLiquid(box) {
    const [cols, rows] = [Math.ceil(box.width / CELL) + 1, Math.ceil(box.height / CELL) + 1];
    if (liquid?.cols === cols && liquid?.rows === rows) return;
    dropLiquid();
    const state = [0, 1].map(() => newTexture(cols, rows, null, gl.NEAREST));
    state.forEach((tex) => clearTexture(tex, FLAT_STATE));
    liquid = { cols, rows, state, read: 0, surface: newTexture(cols, rows) };
    clearTexture(liquid.surface, [128 / 255, 128 / 255, 128 / 255, 1]);
  }
  function dropLiquid() {
    if (!liquid) return;
    [...liquid.state, liquid.surface].forEach((tex) => gl.deleteTexture(tex));
    liquid = null;
  }

  function stepLiquid() {
    const { cols, rows } = liquid;
    const drops = new Float32Array(16);
    splashes.splice(0, 4).forEach(([x, y], i) => {
      drops.set([x / CELL, rows - y / CELL, (settings.splash * 1.5) / CELL, settings.click * 0.8], i * 4);
    });
    const [from, to] = [liquid.state[liquid.read], liquid.state[1 - liquid.read]];
    renderInto(to, cols, rows, stepProgram, (u) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, from);
      gl.uniform1i(u.uState, 0);
      gl.uniform2f(u.uGrid, cols, rows);
      gl.uniform1f(u.uDamping, settings.damping);
      gl.uniform4fv(u.uDrops, drops);
    });
    liquid.read = 1 - liquid.read;
  }

  function updateSurface() {
    renderInto(liquid.surface, liquid.cols, liquid.rows, surfaceProgram, (u) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, liquid.state[liquid.read]);
      gl.uniform1i(u.uState, 0);
      gl.uniform2f(u.uGrid, liquid.cols, liquid.rows);
    });
  }

  const settleMs = () => Math.min(20000, (Math.log(0.002) / Math.log(settings.damping)) * STEP_MS);

  let animating = false, lastTime = 0, owed = 0;
  function wake() {
    lastSplash = performance.now();
    if (animating || !gl || !liquidOn()) return;
    animating = true;
    lastTime = performance.now();
    owed = STEP_MS;
    requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!gl || gl.isContextLost() || !liquidOn()) { animating = false; dropLiquid(); render(); return; }
    ensureLiquid(stage.getBoundingClientRect());
    owed = Math.min(owed + now - lastTime, 4 * STEP_MS);
    lastTime = now;
    for (; owed >= STEP_MS; owed -= STEP_MS) stepLiquid();
    updateSurface();
    render();
    if (now - lastSplash < settleMs()) requestAnimationFrame(tick);
    else { animating = false; dropLiquid(); render(); }
  }

  stage.addEventListener('pointerdown', (e) => {
    const box = stage.getBoundingClientRect();
    if (splashes.length < 4) splashes.push([e.clientX - box.left, e.clientY - box.top]);
    wake();
  });

  function render() {
    if (!gl || gl.isContextLost()) return;
    const box = stage.getBoundingClientRect();
    const wins = [...stage.children].filter((el) => el.classList.contains('win') && !el.hidden);
    buildMain(wins.length);
    const drawn = wins.slice(0, main.capacity);
    const isColumn = (win) => win.dataset.shape === 'column';
    for (const win of drawn) if (!rasters.has(win) && !isColumn(win)) rasterize(win);
    if (atlasDirty || atlas.blur !== settings.blur) buildAtlas();

    const scale = scaleParam || devicePixelRatio;
    const [w, h] = [Math.round(box.width * scale), Math.round(box.height * scale)];
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    gl.viewport(0, 0, w, h);

    const rects = new Float32Array(main.capacity * 4), areas = new Float32Array(main.capacity * 4);
    const alphas = new Float32Array(main.capacity), patterns = new Float32Array(main.capacity * 4), tail = new Float32Array(4);
    drawn.forEach((win, i) => {
      const r = win.getBoundingClientRect();
      if (isColumn(win)) {
        const grow = 2 * settings.feather;
        rects.set([r.left - box.left - grow, -1e5, r.right - box.left + grow, 1e5], i * 4);
      } else {
        rects.set([r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top], i * 4);
      }
      areas.set(atlas.areas.get(win) ?? [0, 0, 0, 0], i * 4);
      alphas[i] = win.style.opacity === '' ? 1 : Number(win.style.opacity);
      if (win.dataset.fadeSeed) patterns.set(win.dataset.fadeSeed.split(',').map(Number), i * 4);
      if (win.hasAttribute('data-popup')) {
        patterns[i * 4 + 3] += 2;
        const [tx, ty, b0, b1] = (win.dataset.tail ?? '').split(',').map(Number);
        if (b1 > b0) tail.set([rects[i * 4] + tx, rects[i * 4 + 1] + ty, rects[i * 4] + b0, rects[i * 4] + b1]);
      }
    });

    gl.useProgram(main.program);
    const textures = {
      uRamp: rampTex, uText: atlas.text, uTextSoft: atlas.textSoft, uMedia: atlas.media, uMediaSoft: atlas.mediaSoft,
      uSurface: liquid ? liquid.surface : stillWater,
      uModel: model.tex ?? stillWater,
      uModelShadow: model.shadow ?? stillWater,
    };
    for (const [name, unit] of Object.entries(UNITS)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    }
    const u = main.uniform;
    gl.uniform2f(u.uSize, box.width, box.height);
    gl.uniform1f(u.uScale, scale);
    gl.uniform4fv(u.uRect, rects);
    gl.uniform4fv(u.uArea, areas);
    gl.uniform1fv(u.uAlpha, alphas);
    gl.uniform4fv(u.uFade, patterns);
    gl.uniform1f(u.uSpread, settings.spread);
    gl.uniform1f(u.uNoiseScale, settings.noiseScale);
    gl.uniform1f(u.uPortalReach, settings.portalReach);
    gl.uniform1f(u.uPortalBlur, settings.portalBlur);
    gl.uniform4fv(u.uTail, tail);
    gl.uniform1f(u.uDither, settings.dither);
    gl.uniform1f(u.uDitherLevels, settings.ditherLevels);
    gl.uniform1f(u.uDitherScale, settings.ditherScale);
    gl.uniform1f(u.uDitherSpread, Number.isNaN(settings.ditherSpread) ? 1 : settings.ditherSpread);
    gl.uniform1f(u.uDitherPattern, settings.ditherPattern);
    const modelWin = model.tex && model.spot ? drawn.indexOf(model.spot.closest('.win')) : -1;
    const mr = model.spot?.getBoundingClientRect();
    gl.uniform4f(u.uModelRect, ...(mr ? [mr.left - box.left, mr.top - box.top, mr.right - box.left, mr.bottom - box.top] : [0, 0, 0, 0]));
    gl.uniform1f(u.uModelWin, modelWin);
    gl.uniform3f(u.uModelLevels, ...settings.modelLevels);
    gl.uniform1f(u.uShadowGray, settings.shadowGray);
    gl.uniform1i(u.uCount, drawn.length);
    gl.uniform1f(u.uFeather, settings.feather);
    gl.uniform1f(u.uBlur, settings.blur);
    gl.uniform1f(u.uHaloSize, settings.haloSize);
    gl.uniform1f(u.uHaloGlow, settings.haloGlow);
    gl.uniform1f(u.uStackGlow, settings.stackGlow);
    gl.uniform1f(u.uOverlay, settings.overlay);
    gl.uniform1f(u.uBg, settings.bg);
    gl.uniform1f(u.uInk, settings.ink);
    gl.uniform3f(u.uInkColor, ...(settings.inkColor.length === 3 ? settings.inkColor : [1, 1, 1]));
    gl.uniform1f(u.uInkOverride, settings.inkOverride);
    gl.uniform1f(u.uMapOn, stage.dataset.map === 'off' ? 0 : 1);
    gl.uniform2f(u.uLiquidSize, liquid ? liquid.cols * CELL : 1, liquid ? liquid.rows * CELL : 1);
    gl.uniform1f(u.uRefract, settings.refract);
    gl.uniform1f(u.uLight, settings.light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const resizes = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target === stage) [...rasters.keys()].forEach(forget);
      else forget(target);
    }
    render();
  });
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.classList?.contains('win')) resizes.observe(node);
      for (const node of record.removedNodes) if (node.classList?.contains('win') && !node.isConnected) forget(node);
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const win = el?.closest('.win');
      if (win && (!(record.type === 'attributes' && el === win) || record.attributeName === 'data-fading')) forget(win);
    }
    render();
  }).observe(stage, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['style', 'hidden', 'class', 'src', 'data-map', 'data-tail', 'data-fading'],
  });
  stage.addEventListener('scroll', (e) => {
    const win = e.target.closest?.('.win');
    if (win) { forget(win); render(); }
  }, true);
  stage.addEventListener('load', (e) => {
    const win = e.target.closest?.('.win');
    if (win) { forget(win); render(); }
  }, true);
  document.fonts?.ready.then(() => { [...rasters.keys()].forEach(forget); render(); });
  addEventListener('model:frame', (e) => {
    if (!gl) return;
    model.spot = e.detail.spot;
    const key = e.detail.layer === 'shadow' ? 'shadow' : 'tex';
    if (!model[key]) model[key] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, model[key]);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, e.detail.canvas);
    if (key === 'tex') render();
  });
  addEventListener('tune:apply', () => {
    if (!gl) return;
    readSettings();
    render();
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    root.classList.remove('gl');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    rasters.clear();
    if (init()) render();
  });

  if (!init()) {
    root.classList.remove('gl');
    return;
  }
  resizes.observe(stage);
  stage.querySelectorAll('.win').forEach((win) => resizes.observe(win));
  render();
})();
