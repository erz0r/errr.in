import { sources } from './content.js';

const ORIGIN = 'https://errr.in';

function plain(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{icon:[\w-]+\} ?/g, '')
    .replace(/\{lastfm:([\w-]+)\}/g, '(what erin is listening to on last.fm right now)')
    .replace(/\{message-box\}/g, '(a text box for sending erin a message)')
    .replace(/\{log\}/g, '(erin\'s latest posts, from a discord channel)')
    .replace(/\{model:[\w-]+\}/g, '')
    .replace(/<p class="label">([^<]*)<\/p>/g, '$1:')
    .replace(/^<\/?div[^>]*>$/gm, '')
    .replace(/^\*{3,}$/gm, '')
    .replace(/\{random:([\w-]+)\}/g, '(a random $1)')
    .replace(/\[([^\]]+)\]\(copy:([^)]+)\)/g, (_, label, value) => (label.trim() === value ? value : `${label} (click to copy: ${value})`))
    .replace(/\]\(#([\w-]+)\)/g, `](${ORIGIN}/#$1)`)
    .replace(/\]\((\/[^)]*)\)/g, `](${ORIGIN}$1)`)
    .replace(/^#+[ \t]*$/gm, '')
    .replace(/^(#+)[ \t]+/gm, '##$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function llmsTxt() {
  const { windows, writeups, description } = await sources();
  windows.sort((a, b) => Number(!!b.settings.open) - Number(!!a.settings.open) || a.name.localeCompare(b.name));
  const pages = [
    ...windows.map((w) => ({ ...w, url: w.settings.open ? `${ORIGIN}/` : `${ORIGIN}/#${w.name}` })),
    ...writeups.map((w) => ({ ...w, url: `${ORIGIN}/writeups/${w.name}/` })),
  ];
  const map = pages.map((p) => `- [${p.title || p.name}](${p.url})`).join('\n');
  const content = pages.map((p) => `## ${p.title || p.name}\n\n${p.url}\n\n${plain(p.body) || '(no text)'}`).join('\n\n');
  return `# errr.in\n\n> ${description}\n\n`
    + 'erin\'s personal site. the home page shows one window at a time, and links like #about open the others.\n\n'
    + `## pages\n\n${map}\n\n${content}\n`;
}
