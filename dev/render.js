import { cssVars, paletteVars, rampHex } from './tune/settings.js';

function pickPalette(choices) {
  const choice = choices[Math.floor(Math.random() * choices.length)];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(choice.vars)) root.style.setProperty(name, value);
  root.dataset.ramp = choice.ramp;
  root.dataset.palette = choice.name;
}

export function renderPage(html, settings, { tune = false, palettes = [] } = {}) {
  const pool = tune || !palettes.length ? [{ name: 'settings', palette: settings.palette }] : palettes;
  const choices = pool.map((p) => ({ name: p.name, ramp: rampHex(p.palette), vars: paletteVars(settings, p.palette) }));
  html = html.replace('<!-- settings:css -->',
    `<style id="settings">\n${cssVars(settings)}\n</style>\n`
    + `<script>(${pickPalette})(${JSON.stringify(choices)});</script>`);
  if (tune) html = html.replace('</body>', '<script type="module" src="/__tune/panel.js"></script>\n</body>');
  return html;
}
