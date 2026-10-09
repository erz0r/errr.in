import { cssVars, rampHex } from './tune/settings.js';

export function renderPage(html, settings, { tune = false, presets = [] } = {}) {
  const pool = tune || !presets.length ? [{ name: 'settings', settings }] : presets;
  const choices = pool.map((p) => ({ name: p.name, ramp: rampHex(p.settings.palette), css: cssVars(p.settings) }));
  html = html.replace('<!-- settings:css -->',
    `<style id="settings">\n${cssVars(settings)}\n</style>\n`
    + `<script type="application/json" id="presets">${JSON.stringify(choices).replace(/</g, '\\u003c')}</script>\n`
    + '<script src="/js/preset.js"></script>');
  if (tune) html = html.replace('</body>', '<script type="module" src="/__tune/panel.js"></script>\n</body>');
  return html;
}
