(() => {
  const root = document.documentElement;
  const stage = document.querySelector('.stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'gl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const scaleParam = Number(new URLSearchParams(location.search).get('scale')) || 0;
  const pixelScale = () => scaleParam || devicePixelRatio;

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

  const LIFE_STEP = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;
float at(vec2 c) { return step(0.5, texture2D(uState, fract(c / uGrid)).r); }
void main() {
  vec2 c = gl_FragCoord.xy;
  float n = at(c + vec2(-1.0, -1.0)) + at(c + vec2(0.0, -1.0)) + at(c + vec2(1.0, -1.0))
    + at(c + vec2(-1.0, 0.0)) + at(c + vec2(1.0, 0.0))
    + at(c + vec2(-1.0, 1.0)) + at(c + vec2(0.0, 1.0)) + at(c + vec2(1.0, 1.0));
  float alive = (n == 3.0 || (n == 2.0 && at(c) > 0.5)) ? 1.0 : 0.0;
  gl_FragColor = vec4(alive, 0.0, 0.0, 1.0);
}`;

  const MAIN = (max, mode = 0) => `${mode === 1 ? '#extension GL_EXT_draw_buffers : require\n' : ''}
precision highp float;
#define MAX ${max}
#define MODE ${mode}
uniform vec2 uSize;
uniform float uScale;
uniform vec4 uRect[MAX];
uniform vec4 uArea[MAX];
uniform float uAlpha[MAX];
uniform vec4 uFade[MAX];
uniform float uSpread, uNoiseScale, uPortalReach, uPortalBlur;
uniform vec4 uTail;
uniform sampler2D uModel, uModelShadow;
uniform float uShadowGray, uShadowStrength;
uniform vec4 uModelRect;
uniform vec4 uInset[8];
uniform float uInsetWin[8];
uniform int uInsetCount;
uniform float uInsetBlur, uInsetMix, uInsetInkMix, uInsetTone, uInsetInkTone;
uniform float uModelWin;
uniform float uModelPacked;
uniform vec3 uModelPanel;
uniform vec3 uModelLevels, uImageLevels;
uniform vec2 uImageRange;
uniform float uDither, uDitherLevels, uDitherScale, uDitherSpread, uDitherPattern;
uniform float uLife, uLifeAlpha;
uniform vec4 uLifeFade;
uniform sampler2D uLifeState;
uniform vec2 uLifeGrid;
uniform int uCount;
uniform float uFeather, uBlur, uHaloSize, uHaloGlow, uStackGlow, uOverlay;
uniform float uBg, uInk, uMapOn;
uniform vec3 uInkColor;
uniform float uInkOverride;
uniform sampler2D uRamp, uText, uTextSoft, uMedia, uMediaSoft;
uniform sampler2D uSurface;
uniform vec2 uLiquidSize;
uniform float uRefract, uLight;
uniform sampler2D uCacheA, uCacheB;
uniform vec2 uCanvas;
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
bool isFlat(vec4 f) { return f.w > 3.5; }

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

float imageGray(vec4 m) {
  if (m.a < 0.001) return 0.0;
  float v = pow(clamp((dot(m.rgb, GRAY) / m.a - uImageLevels.x) / max(uImageLevels.y - uImageLevels.x, 0.001), 0.0, 1.0), 1.0 / max(uImageLevels.z, 0.01));
  return mix(uImageRange.x, uImageRange.y, v) * m.a;
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
  // uLife: 0 plain, 1 the background's dither cells come from the game of life, 2 write which cells start alive.
  // when writing, each fragment is one dither cell, drawn at the cell's center.
  float cellPx = max(uDitherScale, 1.0) * uScale;
  vec2 fc = uLife > 1.5 ? (floor(gl_FragCoord.xy) + 0.5) * cellPx : gl_FragCoord.xy;
  vec2 p = vec2(fc.x, uSize.y * uScale - fc.y) / uScale;
  vec2 cell = floor(fc / cellPx);
  float steps = max(uDitherLevels - 1.0, 1.0);
#if MODE != 1
  vec4 water = (texture2D(uSurface, vec2(p.x, uLiquidSize.y - p.y) / uLiquidSize) * 255.0 - 128.0) / 127.0;
  p += vec2(water.y, -water.z) * uRefract;
  // with the game of life on, live cells sit on the page a tone up, under the halos and windows
  // it fades in and out across the page through the same noise as the windows' fades
  float g0 = uLife > 0.5 && uLife < 1.5
    ? step(0.5, texture2D(uLifeState, (cell + 0.5) / uLifeGrid).r) / steps * fadeAt(uLifeAlpha, p, vec4(0.0, 0.0, uSize), uLifeFade)
    : 0.0;
#endif
#if MODE == 2
  vec4 ca = texture2D(uCacheA, (gl_FragCoord.xy + water.yz * uRefract * uScale) / uCanvas);
  vec4 cb = texture2D(uCacheB, (gl_FragCoord.xy + water.yz * uRefract * uScale) / uCanvas);
  float gA = ca.r, gB = ca.g, ink = ca.b, shade = ca.a, box = cb.r, boxInk = cb.g;
#else
  bool covered = false;
  float e = uHaloSize * 0.6, s = max(uHaloSize, 0.5), reach = e + 3.0 * s;
  float halo[MAX], alpha[MAX];
  float gA = 1.0, gB = 0.0;
  float ink = 0.0;
  float shade = 0.0;
  float box = 0.0;
  float boxInk = 0.0;

  for (int i = 0; i < MAX; i++) {
    halo[i] = 0.0;
    vec4 r = uRect[i];
    alpha[i] = i < uCount ? fadeAt(uAlpha[i], p, r, uFade[i]) : 0.0;
    if (i < uCount && p.x > r.x - reach && p.x < r.z + reach && p.y > r.y - reach && p.y < r.w + reach) {
      if (isFlat(uFade[i])) {
        halo[i] = alpha[i] * uHaloGlow * blurSpan(p.x, r.x - e, r.z + e, s);
      } else if (isPopup(uFade[i])) {
        float hs = min(s, 8.0);
        halo[i] = alpha[i] * uHaloGlow * bubbleEdge(p, r, 0.6 * hs, hs);
      } else {
        halo[i] = alpha[i] * uHaloGlow * roundedBlur(r.xy - e, r.zw + e, p, s, 24.0);
      }
      gA *= 1.0 - halo[i];
      gB += (1.0 - gB) * halo[i];
    }
  }

  for (int i = 0; i < MAX; i++) {
    if (i >= uCount) break;
    vec4 r = uRect[i];
    vec2 size = max(r.zw - r.xy, vec2(1.0)), d = p - r.xy;
    bool popup = isPopup(uFade[i]);
    float sd = popup ? bubble(p, r) : 0.0;
    float inRect = step(0.0, d.x) * step(0.0, d.y) * step(d.x, size.x) * step(d.y, size.y);
    float hg = halo[i] * (popup ? 1.0 : uStackGlow);
    if (alpha[i] <= 0.0 || (hg <= 0.0 && !popup && inRect < 0.5)) continue;
    float feather = uFeather;
    bool level = isFlat(uFade[i]);
    float edge = 1.0;
    if (level) {
      edge = smoothstep(0.0, 1.0, clamp(min(d.x, size.x - d.x) / max(3.0 * uFeather, 1.0), 0.0, 1.0));
    }
    if (popup) {
      feather = mix(20.0, min(uFeather, 4.0), tailTaper(p, r, 8.0, 44.0));
      float clear = alpha[i] * bubbleEdge(p, r, uPortalReach, max(uPortalBlur, 0.5));
      gA *= 1.0 - clear;
      gB *= 1.0 - clear;
      ink *= 1.0 - clear;
      shade *= 1.0 - clear;
      box *= 1.0 - clear;
      boxInk *= 1.0 - clear;
    }
    gA *= 1.0 - hg;
    gB += (1.0 - gB) * hg;
    ink *= 1.0 - hg;
    shade *= 1.0 - hg;
    box *= 1.0 - hg;
    boxInk *= 1.0 - hg;
    if (popup ? sd < 0.0 : inRect > 0.5) {
      covered = true;
      // only pixels inside a window read its textures
      vec2 uv = mix(uArea[i].xy, uArea[i].zw, clamp(d / size, 0.0, 1.0));
      vec4 t = texture2D(uText, uv) * inRect, ts = texture2D(uTextSoft, uv) * inRect;
      vec4 m = texture2D(uMedia, uv) * inRect, ms = texture2D(uMediaSoft, uv) * inRect;
      float tip = popup ? tailTaper(p, r, 0.0, 36.0) : 1.0;
      float fade = (level ? edge : popup ? clamp(-sd / max(feather, 0.5), 0.0, 1.0) * tip : cssFade(d.x, size.x, feather) * cssFade(d.y, size.y, feather)) * alpha[i];
      float cover = popup || level ? 1.0 : blurSpan(p.x, r.x, r.z, uBlur) * blurSpan(p.y, r.y, r.w, uBlur);
      float soft = cover * uBg + imageGray(ms) - ms.a * uBg + ts.r * (uInk - uBg);
      float k = 1.0 - cover * fade;
      gA *= k;
      gB = gB * k + soft * fade;
      ink *= k;
      shade *= k;
      box *= k;
      boxInk *= k;
      float sharp = (level ? edge : popup ? clamp(-sd / max(2.0 * feather, 0.5), 0.0, 1.0) * tip : cssFade(d.x, size.x, 2.0 * feather) * cssFade(d.y, size.y, 2.0 * feather)) * alpha[i];
      float sect = 0.0;
      for (int n = 0; n < 8; n++) {
        if (n >= uInsetCount) break;
        if (abs(uInsetWin[n] - float(i)) < 0.5) {
          vec4 q = uInset[n];
          if (p.x > q.x - 3.0 * uInsetBlur && p.x < q.z + 3.0 * uInsetBlur && p.y > q.y - 3.0 * uInsetBlur && p.y < q.w + 3.0 * uInsetBlur) {
            sect = max(sect, blurSpan(p.x, q.x, q.z, uInsetBlur) * blurSpan(p.y, q.y, q.w, uInsetBlur));
          }
        }
      }
      float content = uBg * (1.0 - m.a) + imageGray(m);
      content = mix(content, uInk, t.r);
      gA *= 1.0 - sharp;
      gB = mix(gB, content, sharp);
      ink = mix(ink, t.r, sharp);
      shade *= 1.0 - sharp;
      box = mix(box, sect * (1.0 - m.a), sharp);
      boxInk = mix(boxInk, sect * t.r, sharp);
      if (abs(float(i) - uModelWin) < 0.5) {
        vec2 mu = (p - uModelRect.xy) / max(uModelRect.zw - uModelRect.xy, vec2(1.0));
        if (mu.x >= 0.0 && mu.x <= 1.0 && mu.y >= 0.0 && mu.y <= 1.0) {
          float ma, sa, mg;
          if (uModelPacked > 0.5) {
            // a baked loop frame: her gray, her alpha and the shadow's alpha, stacked top to bottom
            vec2 cell = vec2(mu.x, clamp(mu.y, uModelPanel.z, 1.0 - uModelPanel.z) * uModelPanel.x);
            mg = texture2D(uModel, cell).r;
            ma = texture2D(uModel, cell + vec2(0.0, uModelPanel.y)).r;
            sa = texture2D(uModel, cell + vec2(0.0, 2.0 * uModelPanel.y)).r;
          } else {
            vec4 mm = texture2D(uModel, vec2(0.502 + 0.496 * mu.x, mu.y));
            sa = texture2D(uModel, vec2(0.002 + 0.496 * mu.x, mu.y)).a;
            ma = mm.a;
            mg = mm.a > 0.001 ? dot(mm.rgb / mm.a, GRAY) : 0.0;
          }
          mg = pow(clamp((mg - uModelLevels.x) / max(uModelLevels.y - uModelLevels.x, 0.001), 0.0, 1.0), 1.0 / max(uModelLevels.z, 0.01));
          sa *= uShadowStrength * fade;
          ma *= fade;
          gA *= 1.0 - sa;
          gB = mix(gB, uShadowGray, sa);
          ink *= 1.0 - sa;
          shade = mix(shade, 1.0, sa);
          box *= 1.0 - sa;
          boxInk *= 1.0 - sa;
          gA *= 1.0 - ma;
          gB = mix(gB, mg, ma);
          shade *= 1.0 - ma;
          ink *= 1.0 - ma;
          box *= 1.0 - ma;
          boxInk *= 1.0 - ma;
        }
      }
      float over = t.r * uOverlay * alpha[i];
      gA *= 1.0 - over;
      gB = mix(gB, uInk, over);
      ink = mix(ink, 1.0, over);
      shade *= 1.0 - over;
      boxInk = mix(boxInk, sect, over);
    }
  }
#endif

#if MODE == 1
  gl_FragData[0] = vec4(gA, gB, ink, shade);
  gl_FragData[1] = vec4(box, boxInk, 0.0, 1.0);
#else
  float g = clamp(g0 * gA + gB + water.x * uLight, 0.0, 1.0);
#if MODE == 0
  if (uLife > 1.5) {
    // the first generation: background dither cells that round up a tone start alive
    float q = quantize(g, threshold(cell));
    gl_FragColor = covered ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(step(floor(g * steps) / steps + 0.5 / steps, q), 0.0, 0.0, 1.0);
    return;
  }
#endif
  if (uDither > 0.0) g = mix(g, quantize(g, threshold(cell)), uDither);
  vec3 color = uMapOn > 0.5 ? texture2D(uRamp, vec2((g * 255.0 + 0.5) / 256.0, 0.5)).rgb : vec3(g);
  if (uMapOn > 0.5) {
    float tint = clamp(box * uInsetMix, 0.0, 1.0);
    if (uDither > 0.0) tint = mix(tint, step(threshold(cell), tint - 0.001), uDither);
    tint *= 1.0 - clamp(ink, 0.0, 1.0);
    if (tint > 0.0) color = mix(color, texture2D(uRamp, vec2((uInsetTone * 255.0 + 0.5) / 256.0, 0.5)).rgb, tint);
    color = mix(color, uInkColor, ink * uInkOverride);
    float boxText = clamp(boxInk * uInsetInkMix, 0.0, 1.0);
    if (boxText > 0.0) color = mix(color, texture2D(uRamp, vec2((uInsetInkTone * 255.0 + 0.5) / 256.0, 0.5)).rgb, boxText);
    if (shade > 0.0) color = mix(color, texture2D(uRamp, vec2((uShadowGray * 255.0 + 0.5) / 256.0, 0.5)).rgb, shade);
  }
  gl_FragColor = vec4(color, 1.0);
#endif
}`;

  const MAIN_UNIFORMS = ['uSize', 'uScale', 'uRect', 'uArea', 'uCount', 'uFeather', 'uBlur', 'uHaloSize',
    'uHaloGlow', 'uStackGlow', 'uOverlay', 'uBg', 'uInk', 'uMapOn',
    'uInkColor', 'uInkOverride', 'uAlpha', 'uFade', 'uSpread', 'uNoiseScale', 'uPortalReach', 'uPortalBlur', 'uTail', 'uDither', 'uDitherLevels', 'uDitherScale', 'uDitherSpread', 'uDitherPattern', 'uModel', 'uModelShadow', 'uShadowGray', 'uShadowStrength', 'uModelRect', 'uInset', 'uInsetWin', 'uInsetCount', 'uInsetBlur', 'uInsetMix', 'uInsetInkMix', 'uInsetTone', 'uInsetInkTone', 'uModelWin', 'uModelPacked', 'uModelPanel', 'uModelLevels', 'uImageLevels', 'uImageRange', 'uRamp', 'uText', 'uTextSoft', 'uMedia', 'uMediaSoft', 'uSurface', 'uLiquidSize', 'uRefract', 'uLight', 'uLife', 'uLifeState', 'uLifeGrid', 'uLifeAlpha', 'uLifeFade', 'uCacheA', 'uCacheB', 'uCanvas'];
  const LOOP_GAP = 16;
  const LIFE_UNIT = 8;
  const UNITS = { uRamp: 0, uText: 1, uTextSoft: 2, uMedia: 3, uMediaSoft: 4, uSurface: 5, uModel: 6, uModelShadow: 7 };
  const CACHE_UNITS = [9, 10];

  let gl = null;
  let blurProgram = null;
  let main = null;
  let maxCapacity = 0;
  let rampTex = null;
  let atlas = null;
  let atlasDirty = true;
  let stepProgram = null, surfaceProgram = null, lifeProgram = null;
  let drawBuffers = null, composite = null, cache = null, stale = true;
  const model = { tex: null, shadow: null, spot: null, panel: null };
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
    for (const attached of gl.getAttachedShaders(program) ?? []) {
      gl.detachShader(program, attached);
      gl.deleteShader(attached);
    }
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
    let next;
    try {
      next = { ...compile(MAIN(capacity), MAIN_UNIFORMS), capacity };
    } catch (err) {
      if (!main) throw err;
      console.warn('keeping fewer window slots:', err);
      maxCapacity = main.capacity;
      return;
    }
    if (main) gl.deleteProgram(main.program);
    if (main?.cache) gl.deleteProgram(main.cache.program);
    main = next;
    gl.useProgram(main.program);
    for (const [name, unit] of Object.entries(UNITS)) gl.uniform1i(main.uniform[name], unit);
    if (!drawBuffers) return;
    try {
      main.cache = compile(MAIN(capacity, 1), MAIN_UNIFORMS);
      gl.useProgram(main.cache.program);
      for (const [name, unit] of Object.entries(UNITS)) gl.uniform1i(main.cache.uniform[name], unit);
    } catch (err) {
      console.warn('no cached rendering:', err);
      main.cache = null;
      drawBuffers = null;
    }
  }

  function warmUp() {
    if (!main?.cache || !composite || !gl || gl.isContextLost()) return;
    const [a, b] = [newTexture(1, 1), newTexture(1, 1)];
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBuffers.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBuffers.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, b, 0);
    drawBuffers.drawBuffersWEBGL([drawBuffers.COLOR_ATTACHMENT0_WEBGL, drawBuffers.COLOR_ATTACHMENT1_WEBGL]);
    gl.viewport(0, 0, 1, 1);
    for (const unit of [...Object.values(UNITS), ...CACHE_UNITS]) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, stillWater);
    }
    gl.useProgram(main.cache.program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawBuffers.drawBuffersWEBGL([drawBuffers.COLOR_ATTACHMENT0_WEBGL, gl.NONE]);
    gl.useProgram(composite.program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(a);
    gl.deleteTexture(b);
    requestRender();
  }

  function ensureCache(w, h) {
    if (cache?.w === w && cache?.h === h) return false;
    if (cache) {
      gl.deleteTexture(cache.a);
      gl.deleteTexture(cache.b);
      gl.deleteFramebuffer(cache.fb);
    }
    gl.activeTexture(gl.TEXTURE0 + CACHE_UNITS[0]);
    const [a, b] = [newTexture(w, h), newTexture(w, h)];
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBuffers.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, drawBuffers.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, b, 0);
    drawBuffers.drawBuffersWEBGL([drawBuffers.COLOR_ATTACHMENT0_WEBGL, drawBuffers.COLOR_ATTACHMENT1_WEBGL]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    cache = { w, h, a, b, fb };
    return true;
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
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      maxCapacity = Math.min(64, Math.floor((gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) - 40) / 4));
      blurProgram = compile(BLUR, ['uSrc', 'uSize', 'uDir', 'uSigma']);
      stepProgram = compile(LIQUID_STEP, ['uState', 'uGrid', 'uDamping', 'uDrops']);
      surfaceProgram = compile(LIQUID_SURFACE, ['uState', 'uGrid']);
      lifeProgram = compile(LIFE_STEP, ['uState', 'uGrid']);
      if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) > LIFE_UNIT) UNITS.uLifeState = LIFE_UNIT;
      life = null;
      model.tex = null;
      model.size = null;
      cache = null;
      composite = null;
      drawBuffers = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) > Math.max(...CACHE_UNITS) ? gl.getExtension('WEBGL_draw_buffers') : null;
      if (drawBuffers) {
        try {
          composite = compile(MAIN(1, 2), MAIN_UNIFORMS);
          gl.useProgram(composite.program);
          for (const [name, unit] of Object.entries(UNITS)) gl.uniform1i(composite.uniform[name], unit);
          gl.uniform1i(composite.uniform.uCacheA, CACHE_UNITS[0]);
          gl.uniform1i(composite.uniform.uCacheB, CACHE_UNITS[1]);
        } catch (err) {
          console.warn('no cached rendering:', err);
          drawBuffers = null;
        }
      }
      stillWater = newTexture(1, 1, new Uint8Array([128, 128, 128, 255]));
      liquid = null;
      main = null;
      buildMain(1);
      rampTex = null;
      atlas = null;
      atlasDirty = true;
      readSettings();
      root.classList.add('gl');
      (window.requestIdleCallback ?? setTimeout)(warmUp, { timeout: 3000 });
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
      imageFadeX: num('--image-fade-x') || 0, imageFadeY: num('--image-fade-y') || 0,
      imageLevels: [num('--image-black') || 0, Number.isNaN(num('--image-white')) ? 1 : num('--image-white'), num('--image-gamma') || 1],
      imageRange: [num('--image-from') || 0, Number.isNaN(num('--image-to')) ? 1 : num('--image-to')],
      modelLevels: [num('--model-black') || 0, Number.isNaN(num('--model-white')) ? 1 : num('--model-white'), num('--model-gamma') || 1],
      ditherPattern: Math.max(0, ['bayer2', 'bayer4', 'bayer8', 'noise', 'lines', 'diagonal'].indexOf(css.getPropertyValue('--dither-pattern').trim())),
      refract: num('--liquid-refract'), light: num('--liquid-light'), damping: num('--liquid-damping'),
      click: num('--liquid-click'), splash: num('--liquid-size'),
      shadowStrength: Number.isNaN(num('--shadow-strength')) ? 1 : num('--shadow-strength'),
      insetMix: num('--inset-mix') || 0, insetInkMix: num('--inset-ink-mix') || 0,
      insetTone: num('--inset-tone') || 0, insetInkTone: num('--inset-ink-tone') || 0, insetBlur: num('--inset-blur') || 0,
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

  function softImage(ctx, img, r) {
    const k = ctx.getTransform().a || 1;
    const c = document.createElement('canvas');
    [c.width, c.height] = [Math.max(1, Math.ceil(r.width * k)), Math.max(1, Math.ceil(r.height * k))];
    const t = c.getContext('2d');
    t.drawImage(img, 0, 0, c.width, c.height);
    t.globalCompositeOperation = 'destination-in';
    const fade = (length, edge, along) => {
      if (!(edge > 0)) return;
      const f = Math.min(edge * k, length / 2) / length;
      const g = along ? t.createLinearGradient(0, 0, c.width, 0) : t.createLinearGradient(0, 0, 0, c.height);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(f * 0.5, 'rgba(0,0,0,0.5)');
      g.addColorStop(f, '#000');
      g.addColorStop(1 - f, '#000');
      g.addColorStop(1 - f * 0.5, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      t.fillStyle = g;
      t.fillRect(0, 0, c.width, c.height);
    };
    fade(c.width, settings.imageFadeX, true);
    fade(c.height, settings.imageFadeY, false);
    ctx.drawImage(c, r.left, r.top, r.width, r.height);
  }

  function drawImage(ctx, img) {
    const r = img.getBoundingClientRect();
    if (img.closest('.log')) return softImage(ctx, img, r);
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

    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (const hr of win.querySelectorAll('hr')) {
      const r = hr.getBoundingClientRect();
      if (!r.width) continue;
      const y = Math.round(r.top + r.height / 2) - 1;
      for (let row = 0; row < 2; row++) {
        for (let i = row, x = r.left + row; x < r.right; i += 2, x += 2) {
          const fromEnd = Math.min(x - r.left, r.right - x) / (r.width * 0.3);
          if (Math.min(1, fromEnd) * 16 > BAYER[(row * 4 + (i >> 1)) % 16]) ctx.fillRect(x, y + row, 1, 1);
        }
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
    if (!gl || gl.isContextLost() || !liquidOn()) { animating = false; dropLiquid(); requestComposite(); return; }
    ensureLiquid(stage.getBoundingClientRect());
    owed = Math.min(owed + now - lastTime, 4 * STEP_MS);
    lastTime = now;
    let stepped = false;
    for (; owed >= STEP_MS; owed -= STEP_MS) { stepLiquid(); stepped = true; }
    if (stepped) {
      updateSurface();
      requestComposite();
    }
    if (now - lastSplash < settleMs()) requestAnimationFrame(tick);
    else { animating = false; dropLiquid(); requestComposite(); }
  }

  stage.addEventListener('pointerdown', (e) => {
    const box = stage.getBoundingClientRect();
    if (splashes.length < 4) splashes.push([e.clientX - box.left, e.clientY - box.top]);
    wake();
  });

  // easter egg: three quick clicks or taps on the background turn its dither dots into conway's game of life,
  // and three more turn it back. windows keep their own dithering; the game runs on under them too.
  const GENERATIONS_PER_SECOND = 15;
  let life = null;
  const lifeCell = () => Math.max(settings.ditherScale, 1) * pixelScale();
  function startLife() {
    const box = stage.getBoundingClientRect(), cellPx = lifeCell();
    const [cols, rows] = [Math.ceil(box.width * pixelScale() / cellPx), Math.ceil(box.height * pixelScale() / cellPx)];
    const state = [0, 1].map(() => newTexture(cols, rows, null, gl.NEAREST));
    const fbs = state.map((tex) => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return fb;
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    life = { cols, rows, state, fbs, read: 0, size: `${box.width}x${box.height}x${cellPx}`, last: performance.now(), owed: 0, checked: performance.now() };
    // the first generation is the dither pattern as it is now
    render(null, { seed: true });
    topUp(true);
    fadeLife(1);
    requestAnimationFrame(stepLife);
  }
  // like a window's fade (window.js): a new noise pattern and sweep each time, run backwards on the way out
  function fadeLife(to) {
    const now = performance.now(), from = life.fade ? lifeAlpha(now) : 0;
    const ms = reducedMotion.matches ? 0 : 2 * (parseFloat(getComputedStyle(root).getPropertyValue('--fade-ms')) || 550) * Math.abs(to - from);
    life.fade = { from, to, start: now, ms, pattern: [Math.random() * 4096, Math.random() * 4096, Math.random() * Math.PI * 2, to < from ? 1 : 0] };
  }
  function lifeAlpha(now) {
    const { from, to, start, ms } = life.fade;
    return ms ? from + (to - from) * Math.min(1, Math.max(0, (now - start) / ms)) : to;
  }
  function stopLife() {
    if (!life) return;
    life.state.forEach((tex) => gl.deleteTexture(tex));
    life.fbs.forEach((fb) => gl.deleteFramebuffer(fb));
    life = null;
    requestComposite();
  }
  // a nearly empty background (or one that has died out) gets a few patches of random soup
  function topUp(first) {
    const { cols, rows } = life;
    const cells = new Uint8Array(cols * rows * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, life.fbs[life.read]);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, cells);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let alive = 0;
    for (let i = 0; i < cells.length; i += 4) alive += cells[i] > 127;
    if (first) life.open = cells.map((v, i) => (i % 4 === 1 ? v : 0)).filter((_, i) => i % 4 === 1);
    if (alive > cols * rows * 0.002) return;
    const free = [];
    for (let i = 0; i < cols * rows; i++) if (!life.open[i]) free.push(i);
    if (!free.length) return;
    const SOUP = 14;
    for (let patch = 0; patch < 6; patch++) {
      const at = free[Math.floor(Math.random() * free.length)];
      const [cx, cy] = [at % cols, Math.floor(at / cols)];
      for (let y = 0; y < SOUP; y++) {
        for (let x = 0; x < SOUP; x++) {
          const i = ((cy + y) % rows) * cols + ((cx + x) % cols);
          if (Math.random() < 0.4) cells[i * 4] = 255;
        }
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, life.state[life.read]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, cells);
  }
  function stepLife(now) {
    if (!life || !gl || gl.isContextLost()) return;
    const box = stage.getBoundingClientRect();
    if (`${box.width}x${box.height}x${lifeCell()}` !== life.size) return stopLife();
    life.owed = Math.min(life.owed + now - life.last, 4000 / GENERATIONS_PER_SECOND);
    life.last = now;
    let stepped = false;
    for (; life.owed >= 1000 / GENERATIONS_PER_SECOND; life.owed -= 1000 / GENERATIONS_PER_SECOND) {
      const [from, to] = [life.read, 1 - life.read];
      gl.bindFramebuffer(gl.FRAMEBUFFER, life.fbs[to]);
      gl.viewport(0, 0, life.cols, life.rows);
      gl.useProgram(lifeProgram.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, life.state[from]);
      gl.uniform1i(lifeProgram.uniform.uState, 0);
      gl.uniform2f(lifeProgram.uniform.uGrid, life.cols, life.rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      life.read = to;
      stepped = true;
    }
    if (now - life.checked > 3000) { life.checked = now; topUp(false); }
    const alpha = lifeAlpha(now), fading = alpha !== life.fade.to;
    if (!fading && life.fade.to === 0) return stopLife();
    if (stepped || fading || alpha !== life.drawnAlpha) requestComposite();
    life.drawnAlpha = alpha;
    requestAnimationFrame(stepLife);
  }

  let taps = [];
  stage.addEventListener('pointerdown', (e) => {
    const win = e.target.closest('.win:not([data-shape])');
    const empty = win?.hasAttribute('data-flat') && !e.target.closest('a, button, textarea, p, li, h1, h2, h3, img, time, hr');
    if ((win && !empty) || !gl || !UNITS.uLifeState) return;
    taps = [...taps.filter((t) => e.timeStamp - t.at < 600 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 40), { at: e.timeStamp, x: e.clientX, y: e.clientY }];
    if (taps.length < 3) return;
    taps = [];
    if (!life) startLife();
    else fadeLife(life.fade.to ? 0 : 1);
  });

  // everything that changes the picture asks for a frame here, so it's drawn at most once per display frame.
  // a region (stage px) redraws only that box, if nothing else asked for the whole page.
  let queued = null, scheduled = false, fullSize = '', recompose = false;
  function requestRender(region = null) {
    queued = !region || queued === 'all' ? 'all' : queued ? unite(queued, region) : region;
    schedule();
  }
  function requestComposite() {
    recompose = true;
    schedule();
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const [r, c] = [queued, recompose];
      queued = null;
      recompose = false;
      if (r) render(r === 'all' ? null : r, { compositeFull: c });
      else if (c) render(null, { compositeOnly: true });
    });
  }
  const unite = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

  function render(region = null, { seed = false, compositeOnly = false, compositeFull = false } = {}) {
    if (!gl || gl.isContextLost()) return;
    if (!region && !seed) queued = null;
    const box = stage.getBoundingClientRect();
    const wins = [...stage.children].filter((el) => el.classList.contains('win') && !el.hidden);
    buildMain(wins.length);
    const drawn = wins.slice(0, main.capacity);
    const isColumn = (win) => win.dataset.shape === 'column';
    for (const win of drawn) if (!rasters.has(win) && !isColumn(win)) rasterize(win);
    if (atlasDirty || atlas.blur !== settings.blur) buildAtlas();

    const scale = pixelScale();
    const [w, h] = [Math.round(box.width * scale), Math.round(box.height * scale)];
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    gl.viewport(0, 0, w, h);
    const size = `${w}x${h}`;
    let clip = null;
    if (seed) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, life.fbs[life.read]);
      gl.viewport(0, 0, life.cols, life.rows);
    } else if (region && size === fullSize) {
      const [x0, y0] = [Math.max(0, Math.floor(region.x0 * scale) - 2), Math.max(0, Math.floor(region.y0 * scale) - 2)];
      const [x1, y1] = [Math.min(w, Math.ceil(region.x1 * scale) + 2), Math.min(h, Math.ceil(region.y1 * scale) + 2)];
      if (x1 > x0 && y1 > y0) clip = [x0, h - y1, x1 - x0, y1 - y0];
      else if (compositeFull) compositeOnly = true;
      else return;
    } else {
      fullSize = size;
    }

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
      if (win.hasAttribute('data-flat')) patterns[i * 4 + 3] += 4;
      if (win.hasAttribute('data-popup')) {
        patterns[i * 4 + 3] += 2;
        const [tx, ty, b0, b1] = (win.dataset.tail ?? '').split(',').map(Number);
        if (b1 > b0) tail.set([rects[i * 4] + tx, rects[i * 4 + 1] + ty, rects[i * 4] + b0, rects[i * 4] + b1]);
      }
    });

    const textures = {
      uRamp: rampTex, uText: atlas.text, uTextSoft: atlas.textSoft, uMedia: atlas.media, uMediaSoft: atlas.mediaSoft,
      uSurface: liquid ? liquid.surface : stillWater,
      uModel: model.tex ?? stillWater,
      uModelShadow: model.shadow ?? stillWater,
      uLifeState: life && !seed ? life.state[life.read] : stillWater,
    };
    for (const [name, unit] of Object.entries(UNITS)) {
      if (!(name in textures)) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, textures[name]);
    }
    const send = (prog) => {
      gl.useProgram(prog.program);
      const u = prog.uniform;
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
      gl.uniform1f(u.uModelPacked, model.panel ? 1 : 0);
      gl.uniform3f(u.uModelPanel, ...(model.panel ?? [1, 0, 0]));
      const insets = new Float32Array(32), insetWins = new Float32Array(8);
      let insetCount = 0;
      drawn.forEach((win, i) => {
        for (const sect of win.querySelectorAll('.sect')) {
          if (insetCount >= 8) break;
          const q = sect.getBoundingClientRect();
          if (!q.width) continue;
          insets.set([q.left - box.left, q.top - box.top, q.right - box.left, q.bottom - box.top], insetCount * 4);
          insetWins[insetCount++] = i;
        }
      });
      gl.uniform4fv(u.uInset, insets);
      gl.uniform1fv(u.uInsetWin, insetWins);
      gl.uniform1i(u.uInsetCount, insetCount);
      gl.uniform1f(u.uInsetBlur, settings.insetBlur);
      gl.uniform1f(u.uInsetMix, settings.insetMix);
      gl.uniform1f(u.uInsetInkMix, settings.insetInkMix);
      gl.uniform1f(u.uInsetTone, settings.insetTone);
      gl.uniform1f(u.uInsetInkTone, settings.insetInkTone);
      gl.uniform3f(u.uModelLevels, ...settings.modelLevels);
      gl.uniform3f(u.uImageLevels, ...settings.imageLevels);
      gl.uniform2f(u.uImageRange, ...settings.imageRange);
      gl.uniform1f(u.uShadowGray, settings.shadowGray);
      gl.uniform1f(u.uShadowStrength, settings.shadowStrength);
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
      gl.uniform1f(u.uLife, seed ? 2 : life ? 1 : 0);
      gl.uniform1f(u.uLifeAlpha, life?.fade ? lifeAlpha(performance.now()) : 0);
      gl.uniform4fv(u.uLifeFade, life?.fade?.pattern ?? [0, 0, 0, 0]);
      gl.uniform2f(u.uLifeGrid, life?.cols ?? 1, life?.rows ?? 1);
      gl.uniform2f(u.uCanvas, w, h);
    };
    const scissor = (area) => {
      if (!area) return gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(...area);
    };
    if (seed || !main.cache || !(animating || life) || (!compositeOnly && !clip)) {
      if (!seed) stale = true;
      scissor(seed || compositeFull || compositeOnly ? null : clip);
      send(main);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      const fresh = ensureCache(w, h) || stale;
      stale = false;
      if (fresh || !compositeOnly) {
        for (const unit of CACHE_UNITS) {
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
        scissor(fresh ? null : clip);
        gl.bindFramebuffer(gl.FRAMEBUFFER, cache.fb);
        send(main.cache);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      [cache.a, cache.b].forEach((tex, i) => {
        gl.activeTexture(gl.TEXTURE0 + CACHE_UNITS[i]);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      });
      scissor(compositeOnly || compositeFull ? null : clip);
      send(composite);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
    if (seed) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  const resizes = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (target === stage) [...rasters.keys()].forEach(forget);
      else forget(target);
    }
    requestRender();
  });
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.classList?.contains('win')) resizes.observe(node);
      for (const node of record.removedNodes) if (node.classList?.contains('win') && !node.isConnected) forget(node);
      const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const win = el?.closest('.win');
      if (win && (!(record.type === 'attributes' && el === win) || record.attributeName === 'data-fading')) forget(win);
    }
    requestRender();
  }).observe(stage, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['style', 'hidden', 'class', 'src', 'data-map', 'data-tail', 'data-fading'],
  });
  stage.addEventListener('scroll', (e) => {
    const win = e.target.closest?.('.win');
    if (win) { forget(win); requestRender(); }
  }, true);
  stage.addEventListener('load', (e) => {
    const win = e.target.closest?.('.win');
    if (win) { forget(win); requestRender(); }
  }, true);
  document.fonts?.ready.then(() => { [...rasters.keys()].forEach(forget); requestRender(); });
  // her pixels only reach her box, so a new frame of her redraws just that
  const modelBox = () => {
    const s = stage.getBoundingClientRect(), r = model.spot.getBoundingClientRect();
    return { x0: r.left - s.left, y0: r.top - s.top, x1: r.right - s.left, y1: r.bottom - s.top };
  };
  addEventListener('model:frame', (e) => {
    if (!gl) return;
    const first = !model.tex;
    model.spot = e.detail.spot;
    const { video } = e.detail;
    if (video) {
      // baked loop: three panels of `panel` rows each, `gap` rows apart (dev/bake-model.js)
      const panel = (video.videoHeight - 2 * LOOP_GAP) / 3;
      model.panel = [panel / video.videoHeight, (panel + LOOP_GAP) / video.videoHeight, 0.5 / panel];
    }
    const source = video ?? e.detail.canvas;
    const [sw, sh] = video ? [video.videoWidth, video.videoHeight] : [source.width, source.height];
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (!model.tex) {
      model.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, model.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, model.tex);
    if (!video && model.size === `${sw}x${sh}`) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    model.size = `${sw}x${sh}`;
    requestRender(first ? null : modelBox());
  });
  let layout = '';
  addEventListener('tune:apply', () => {
    if (!gl) return;
    readSettings();
    const css = getComputedStyle(root);
    const next = ['--sect-pad-x', '--sect-pad-y', '--cols-split', '--cols-gap', '--image-fade-x', '--image-fade-y'].map((name) => css.getPropertyValue(name)).join();
    if (next !== layout) {
      layout = next;
      [...rasters.keys()].forEach(forget);
    }
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
