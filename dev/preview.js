import { writeFile } from 'node:fs/promises';
import { circlePng } from './icon.js';
import { loadPresets } from './presets.js';

const name = process.argv[2] ?? 'lavender';
const preset = (await loadPresets()).find((p) => p.name === name);
if (!preset) {
  console.error(`no preset called "${name}" in presets/`);
  process.exit(1);
}
await writeFile('site/media/preview.png', circlePng(preset.settings.palette, 1200, 630, 560, { opaque: true }));
console.log(`wrote site/media/preview.png from ${name}`);
