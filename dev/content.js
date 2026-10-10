import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Marked } from 'marked';
import markedFootnote from 'marked-footnote';

const CONTENT = 'content';
const ICONS = join('site', 'media', 'icons');
const SITE = 'site';
const ORIGIN = 'https://errr.in';
const markdown = new Marked().use(markedFootnote({ description: 'Bibliography' }));

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function parse(text) {
  const settings = {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
      if (!kv) continue;
      const v = kv[2];
      settings[kv[1]] = v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(v) ? Number(v) : v;
    }
  }
  const body = match ? text.slice(match[0].length) : text;
  const title = settings.title ?? body.match(/^#\s+(.+)$/m)?.[1] ?? '';
  return { settings, title, body, html: markdown.parse(body) };
}

async function withIcons(html) {
  const names = [...new Set([...html.matchAll(/\{icon:([\w-]+)\}/g)].map((m) => m[1]))];
  for (const name of names) {
    const svg = await readFile(join(ICONS, `${name}.svg`), 'utf8').catch(() => null);
    if (!svg) throw new Error(`{icon:${name}}: no file site/media/icons/${name}.svg`);
    const inline = svg.trim()
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace(/\s(role|xmlns)="[^"]*"/g, '')
      .replace('<svg', '<svg class="icon" aria-hidden="true" focusable="false"');
    html = html.replace(new RegExp(`\\{icon:${name}\\} ?`, 'g'), inline);
  }
  return html;
}

async function withLastfm(html) {
  if (!html.includes('{lastfm:')) return html;
  const key = (await readFile('lastfm.key', 'utf8').catch(() => '')).trim();
  const attrs = (user) => `class="lastfm" data-user="${escape(user)}" data-key="${escape(key)}" hidden`;
  return html
    .replace(/<p>\{lastfm:([\w-]+)\}<\/p>/g, (_, user) => (key ? `<p ${attrs(user)}></p>` : ''))
    .replace(/\{lastfm:([\w-]+)\}/g, (_, user) => (key ? `<span ${attrs(user)}></span>` : ''));
}

const MESSAGE_BOX = '<form class="message-box" novalidate><div class="message-row">'
  + '<textarea name="message" rows="1" maxlength="2000" placeholder="anything.." aria-label="your message" autofocus></textarea>'
  + '<button type="submit" aria-label="send"><svg viewBox="0 0 10 10"><path d="M3.5 1.5L7 5l-3.5 3.5"/></svg></button>'
  + '</div><input class="trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
  + '<p class="message-status" role="status"></p></form>';
const withMessageBox = (html) => html.replace(/<p>\{message-box\}<\/p>|\{message-box\}/g, MESSAGE_BOX);

const newTabs = (html) => html.replace(/<a href="(https?:\/\/[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener"');

const siteDescription = () => readFile(join(CONTENT, 'description.txt'), 'utf8').then((t) => t.trim(), () => '');

const versioned = (path) => `${path}?v=${createHash('sha256').update(readFileSync(join(SITE, path))).digest('hex').slice(0, 8)}`;

const withHead = (html, { title, description, url }) => html
  .replaceAll('https://errr.in/media/preview.png"', `https://errr.in${versioned('/media/preview.png')}"`)
  .replaceAll('<!-- content:title -->', escape(title))
  .replaceAll('<!-- content:og-title -->', escape(title))
  .replaceAll('<!-- content:description -->', escape(description))
  .replaceAll('<!-- content:url -->', escape(ORIGIN + url));

async function load(dir) {
  const files = (await readdir(join(CONTENT, dir)).catch(() => [])).filter((f) => f.endsWith('.md')).sort();
  return Promise.all(files.map(async (f) => {
    const name = basename(f, '.md');
    const headings = await readFile(join(CONTENT, dir, `${name}.headings.txt`), 'utf8')
      .then((text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), () => []);
    const page = parse(await readFile(join(CONTENT, dir, f), 'utf8'));
    return { name, headings, ...page, html: withMessageBox(newTabs(await withLastfm(await withIcons(page.html)))) };
  }));
}

const BACK = '<button class="back" type="button" aria-label="Back" hidden><svg viewBox="0 0 10 10"><path d="M6.5 1.5L3 5l3.5 3.5"/></svg></button>';

function windowHtml({ name, settings, title, html, headings }) {
  html = html.replace(/(id="|href="#|aria-describedby=")footnote-/g, `$1footnote-${name}-`);
  const style = [
    typeof settings.width === 'number' && `--w: ${settings.width}px`,
    typeof settings['max-width'] === 'number' && `--max-w: ${settings['max-width']}px`,
    typeof settings.height === 'number' && `--h: ${settings.height}px`,
  ].filter(Boolean).join('; ');
  return `<section class="win" data-window="${escape(name)}"`
    + (settings.place ? ` data-place="${escape(settings.place)}"` : '')
    + (settings.width === 'fit' ? ' data-fit' : '')
    + (settings.popup ? ' data-popup' : '')
    + (headings.length ? ` data-headings="${escape(JSON.stringify(headings))}"` : '')
    + ` aria-label="${escape(title)}" tabindex="-1"`
    + (style ? ` style="${style}"` : '')
    + (settings.open ? '' : ' hidden')
    + `>\n<div class="txt">\n${html}</div>\n${BACK}\n</section>`;
}

export async function sources() {
  const read = async (dir) => {
    const files = (await readdir(join(CONTENT, dir)).catch(() => [])).filter((f) => f.endsWith('.md')).sort();
    return Promise.all(files.map(async (f) => ({ name: basename(f, '.md'), ...parse(await readFile(join(CONTENT, dir, f), 'utf8')) })));
  };
  return { windows: await read('windows'), writeups: await read('writeups'), description: await siteDescription() };
}

export async function routes() {
  return ['/', ...(await load('writeups')).map((w) => `/writeups/${w.name}/`)];
}

export async function renderRoute(pathname) {
  if (pathname === '/' || pathname === '/index.html') return home();
  if (pathname === '/404.html') return home({ missing: true });
  const name = pathname.match(/^\/writeups\/([\w-]+)\/?$/)?.[1];
  if (!name) return null;
  const writeup = (await load('writeups')).find((w) => w.name === name);
  if (!writeup) return null;
  const template = await readFile(join(SITE, 'writeup.html'), 'utf8');
  return withHead(template.replace('<!-- content:article -->', writeup.html), {
    title: writeup.title,
    description: writeup.settings.description ?? await siteDescription(),
    url: `/writeups/${name}/`,
  });
}

async function home({ missing = false } = {}) {
  let template = await readFile(join(SITE, 'index.html'), 'utf8');
  let windows = await load('windows');
  if (missing) {
    const page = parse(await readFile(join(CONTENT, '404.md'), 'utf8').catch(() => '# not found'));
    windows = windows.map((w) => ({ ...w, settings: { ...w.settings, open: false } }));
    windows.push({ ...page, name: '404', headings: [], html: withMessageBox(newTabs(await withLastfm(await withIcons(page.html)))), settings: { ...page.settings, open: true } });
    template = template.replace('<title>errr.in</title>', `<title>${escape(page.title || 'not found')} · errr.in</title>`);
  }
  windows.sort((a, b) => Number(!!a.settings.open) - Number(!!b.settings.open));
  return withHead(template.replace('<!-- content:windows -->', windows.map(windowHtml).join('\n')),
    { title: 'errr.in', description: await siteDescription(), url: '/' });
}
