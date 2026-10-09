import { cssVars, rampHex } from './tune/settings.js';

function pickPreset(choices) {
  const choice = choices[Math.floor(Math.random() * choices.length)];
  const root = document.documentElement;
  document.getElementById('settings').textContent = choice.css;
  root.dataset.ramp = choice.ramp;
  root.dataset.preset = choice.name;
}

export function renderPage(html, settings, { tune = false, presets = [] } = {}) {
  const pool = tune || !presets.length ? [{ name: 'settings', settings }] : presets;
  const choices = pool.map((p) => ({ name: p.name, ramp: rampHex(p.settings.palette), css: cssVars(p.settings) }));
  html = html.replace('<!-- settings:css -->',
    `<style id="settings">\n${cssVars(settings)}\n</style>\n`
    + `<script>(${pickPreset})(${JSON.stringify(choices)});</script>`);
  if (tune) html = html.replace('</body>', '<script type="module" src="/__tune/panel.js"></script>\n</body>');
  return html;
}
