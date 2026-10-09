import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { formatSettings, validate } from './tune/settings.js';

const DIR = 'presets';

export const presetName = (name) => String(name ?? '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export async function loadPresets() {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  const presets = [];
  for (const file of files) {
    try {
      presets.push({ name: file.slice(0, -5), settings: validate(JSON.parse(await readFile(join(DIR, file), 'utf8'))) });
    } catch (err) {
      console.warn(`skipping presets/${file}: ${err.message}`);
    }
  }
  return presets;
}

export async function savePreset(name, settings) {
  const clean = presetName(name);
  if (!clean) throw new Error('a preset needs a name (letters or digits)');
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${clean}.json`), formatSettings(settings));
  return clean;
}

export async function deletePreset(name) {
  const clean = presetName(name);
  if (!clean || clean !== name) throw new Error('no such preset');
  await unlink(join(DIR, `${clean}.json`));
}
