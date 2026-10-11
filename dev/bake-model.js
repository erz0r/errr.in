// bakes the loop phones play instead of the live model (site/js/model.js).
// each frame stacks three grayscale panels, exactly what the renderer reads from the live model:
// her gray (before levels), her alpha, the shadow's alpha. one loop per model light/fill/shadow angle/height/turn used by
// settings.json or a preset, since the light changes her gray. needs ffmpeg and a playwright chromium
// (npx playwright install chromium).
import { spawn } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { loadPresets } from './presets.js';

const NAME = 'erinsona';
const [W, H, SCALE] = [540, 400, 1.5]; // the .model box in site.css with its room for the shadow
const GAP = 16; // rows between panels; matches LOOP_GAP in renderer.js
const FPS = 30;
const CYCLES = 3; // loop length in SitIdle cycles
// blinks and ear twitches at fixed times inside the loop, each over before it wraps
const BLINKS = [{ at: 1.4, twice: false }, { at: 5.1, twice: true }, { at: 9.3, twice: false }];
const TWITCHES = [{ at: 3.2, who: 0, twice: false }, { at: 7.4, who: 2, twice: true }, { at: 10.6, who: 1, twice: false }];

const settings = [JSON.parse(await readFile('settings.json', 'utf8')), ...(await loadPresets()).map((p) => p.settings)];
const lights = [...new Map(settings.map((s) => {
  const [light, fill] = [s.modelLight ?? 1.3, s.modelFill ?? 0.5]; // same fallbacks as model.js
  const [angle, height, turn] = [s.shadowAngle ?? 51, s.shadowHeight ?? 39, s.modelTurn ?? -34];
  return [[light, fill, angle, height, turn].join('_'), { light, fill, angle, height, turn }];
})).values()];

const SITE = resolve('site');
const TYPES = { '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
const browser = await chromium.launch({
  args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.route('http://bake/**', async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') return route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' });
  route.fulfill({ body: await readFile(join(SITE, path)), contentType: TYPES[extname(path)] ?? 'application/octet-stream' });
});
await page.goto('http://bake/');

for (const old of (await readdir('site/media')).filter((f) => f.startsWith(`${NAME}-loop-`))) await rm(join('site/media', old));

for (const { light, fill, angle, height, turn } of lights) {
  const info = await page.evaluate(async ({ NAME, W, H, SCALE, GAP, light, fill, angle, height, turn }) => {
    const THREE = await import('/js/vendor/three.js');
    const { createScene } = await import('/js/model-scene.js');
    const her = document.createElement('canvas');
    window.her = await createScene(THREE, `/media/${NAME}.glb`, her, { light, fill, angle, height, turn });
    window.her.resize(W * SCALE, H * SCALE);

    // a webgl1 context that takes her canvas the way renderer.js does and writes the three panels
    const [pw, ph] = [W * SCALE, H * SCALE];
    const pack = Object.assign(document.createElement('canvas'), { width: pw, height: 3 * ph + 2 * GAP });
    const gl = pack.getContext('webgl', { preserveDrawingBuffer: true });
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }'));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `precision highp float;
uniform sampler2D uModel, uShadow;
const vec3 GRAY = vec3(0.2126, 0.7152, 0.0722);
void main() {
  float row = floor(${pack.height}.0 - gl_FragCoord.y);
  float k = floor(row / ${ph + GAP}.0), local = row - k * ${ph + GAP}.0;
  vec2 uv = vec2(gl_FragCoord.x / ${pw}.0, (local + 0.5) / ${ph}.0);
  vec4 mm = texture2D(uModel, uv);
  float v = k < 0.5 ? (mm.a > 0.001 ? clamp(dot(mm.rgb / mm.a, GRAY), 0.0, 1.0) : 0.0)
    : k < 1.5 ? mm.a : texture2D(uShadow, uv).a;
  gl_FragColor = vec4(vec3(local < ${ph}.0 ? v : 0.0), 1.0);
}`));
    gl.bindAttribLocation(program, 0, 'p');
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const textures = ['uModel', 'uShadow'].map((name, unit) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
      return tex;
    });

    window.bakeFrame = (state) => {
      window.her.pose(state);
      window.her.draw((layer) => {
        gl.activeTexture(gl.TEXTURE0 + (layer === 'model' ? 0 : 1));
        gl.bindTexture(gl.TEXTURE_2D, textures[layer === 'model' ? 0 : 1]);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, her);
      });
      gl.viewport(0, 0, pack.width, pack.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const rgba = new Uint8Array(pack.width * pack.height * 4);
      gl.readPixels(0, 0, pack.width, pack.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      const gray = new Uint8Array(pack.width * pack.height);
      for (let y = 0; y < pack.height; y++) {
        const from = (pack.height - 1 - y) * pack.width; // readPixels starts at the bottom row
        for (let x = 0; x < pack.width; x++) gray[y * pack.width + x] = rgba[(from + x) * 4];
      }
      let s = '';
      for (let i = 0; i < gray.length; i += 0x8000) s += String.fromCharCode(...gray.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return { width: pack.width, height: pack.height, duration: window.her.duration, renderer: THREE.REVISION };
  }, { NAME, W, H, SCALE, GAP, light, fill, angle, height, turn });

  const out = `site/media/${NAME}-loop-${[light, fill, angle, height, turn].join('_')}.mp4`;
  // BAKE_RAW=<file> also keeps the frames uncompressed, for comparing encodings
  const raw = process.env.BAKE_RAW && (await import('node:fs')).createWriteStream(`${process.env.BAKE_RAW}-${[light, fill, angle, height, turn].join('_')}.gray`);
  const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${info.width}x${info.height}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '23', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.round(info.duration * CYCLES * FPS);
  const latest = (events, t) => events.filter((e) => e.at <= t).at(-1);
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    const state = { time: t, t, blink: latest(BLINKS, t), twitch: latest(TWITCHES, t) };
    const frame = Buffer.from(await page.evaluate((s) => window.bakeFrame(s), state), 'base64');
    raw?.write(frame);
    if (!ffmpeg.stdin.write(frame)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  ffmpeg.stdin.end();
  raw?.end();
  const code = await new Promise((r) => ffmpeg.on('close', r));
  if (code) throw new Error(`ffmpeg failed for ${out}`);
  const { size } = await import('node:fs').then((fs) => fs.statSync(out));
  console.log(`wrote ${out} (${frames} frames, ${Math.round(size / 1024)} KB)`);
}
await browser.close();
