import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validatePalette } from './tune/settings.js';

const DIR = 'palettes';

export const presetName = (name) => String(name ?? '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function loadPalettes() {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  const presets = [];
  for (const file of files) {
    try {
      const { palette } = JSON.parse(await readFile(join(DIR, file), 'utf8'));
      presets.push({ name: file.slice(0, -5), palette: validatePalette(palette) });
    } catch (err) {
      console.warn(`Skipping palettes/${file}: ${err.message}`);
    }
  }
  return presets;
}

export async function savePalette(name, palette) {
  const clean = presetName(name);
  if (!clean) throw new Error('a preset needs a name (letters or digits)');
  const stops = validatePalette(palette).map((s) => `    { "pos": ${s.pos}, "color": "${s.color}" }`).join(',\n');
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${clean}.json`), `{\n  "palette": [\n${stops}\n  ]\n}\n`);
}

export async function deletePalette(name) {
  const clean = presetName(name);
  if (!clean || clean !== name) throw new Error('no such preset');
  await unlink(join(DIR, `${clean}.json`));
}
