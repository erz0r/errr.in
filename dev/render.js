import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssVars, rampHex } from './tune/settings.js';

const version = (path) => createHash('sha256').update(readFileSync(join('site', path))).digest('hex').slice(0, 8);
const withVersions = (html) => html.replace(/(src|href)="(\/(?:js|css)\/[\w.-]+\.(?:js|css))"/g,
  (_, attr, path) => `${attr}="${path}?v=${version(path)}"`);

export function renderPage(html, settings, { tune = false, presets = [] } = {}) {
  const pool = tune || !presets.length ? [{ name: 'settings', settings }] : presets;
  const choices = pool.map((p) => ({ name: p.name, ramp: rampHex(p.settings.palette), css: cssVars(p.settings) }));
  html = html.replace('<!-- settings:css -->',
    `<style id="settings">\n${cssVars(settings)}\n</style>\n`
    + `<script type="application/json" id="presets">${JSON.stringify(choices).replace(/</g, '\\u003c')}</script>\n`
    + '<script src="/js/preset.js"></script>');
  html = withVersions(html);
  if (tune) html = html.replace('</body>', '<script type="module" src="/__tune/panel.js"></script>\n</body>');
  return html;
}
