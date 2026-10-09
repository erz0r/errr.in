import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderRoute, routes } from './content.js';
import { ICONS } from './icon.js';
import { loadPresets } from './presets.js';
import { renderPage } from './render.js';
import { validate } from './tune/settings.js';

const TEMPLATES = ['index.html', 'writeup.html'];

const settings = validate(JSON.parse(await readFile('settings.json', 'utf8')));
const presets = await loadPresets();
await rm('dist', { recursive: true, force: true });
await cp('site', 'dist', { recursive: true, filter: (src) => !TEMPLATES.some((t) => src.endsWith(join('site', t))) });

for (const route of await routes()) {
  const dir = join('dist', route);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), renderPage(await renderRoute(route), settings, { presets }));
}
await writeFile(join('dist', '404.html'), renderPage(await renderRoute('/404.html'), settings, { presets }));
for (const [path, draw] of Object.entries(ICONS)) await writeFile(join('dist', path), draw(settings.palette));
console.log('built dist/');
