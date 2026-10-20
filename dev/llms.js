import { readLines, sources } from './content.js';

const ORIGIN = 'https://errr.in';

// footnotes the text never points to aren't shown on the site, so they're left out here too
function shownNotes(body) {
  const used = new Set([...body.matchAll(/\[\^([^\]]+)\](?!:)/g)].map((m) => m[1]));
  return body.replace(/^\[\^([^\]]+)\]:.*(?:\n(?!\n|\[\^).*)*\n?/gm, (note, id) => (used.has(id) ? note : ''));
}

function plain(body) {
  return shownNotes(body)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{icon:[\w-]+\} ?/g, '')
    .replace(/\{lastfm:([\w-]+)\}/g, '(what erin is listening to on last.fm right now, or what erin last listened to and when)')
    .replace(/\{message-box\}/g, '(a text box for sending erin a message, which only erin sees)')
    .replace(/\{log\}/g, `(erin's 15 newest posts from a discord channel, newest first, with their times and any pictures. they update live; the current ones are at ${ORIGIN}/api/log as json)`)
    .replace(/\{model:[\w-]+\}/g, '(a small animated 3d model of erinsona, erin\'s character, sitting and swaying, blinking and flicking her ears now and then. on computers her head and eyes follow the cursor)')
    .replace(/<p class="label">([^<]*)<\/p>/g, '$1:')
    .replace(/^<\/?div[^>]*>$/gm, '')
    .replace(/^<br\s*\/?>$/gm, '')
    .replace(/^\*{3,}$/gm, '')
    .replace(/\{random:([\w-]+)\}/g, '(a random pick from the $1 list at the end)')
    .replace(/\[([^\]]+)\]\(copy:([^)]+)\)/g, (_, label, value) => (label.trim() === value ? value : `${label} (click to copy: ${value})`))
    .replace(/\]\(#([\w-]+)\)/g, `](${ORIGIN}/#$1)`)
    .replace(/\]\((\/[^)]*)\)/g, `](${ORIGIN}$1)`)
    .replace(/^#+[ \t]*$/gm, '')
    .replace(/^(#+)[ \t]+/gm, '##$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function llmsTxt() {
  const { windows, writeups, missing, description } = await sources();
  windows.sort((a, b) => Number(!!b.settings.open) - Number(!!a.settings.open) || a.name.localeCompare(b.name));
  const pages = [
    ...windows.map((w) => ({ ...w, url: w.settings.open ? `${ORIGIN}/` : `${ORIGIN}/#${w.name}` })),
    ...writeups.map((w) => ({ ...w, writeup: true, url: `${ORIGIN}/writeups/${w.name}/` })),
    { ...missing, name: '404', title: `${missing.title || 'not found'} (any address that doesn't exist)`, url: `${ORIGIN}/404.html` },
  ];
  // a window with a list of headings shows a random one of them on each visit
  const lists = new Map(pages.filter((p) => p.headings?.length).map((p) => [`${p.name} headings`, p.headings]));
  const text = (p) => {
    const body = plain(p.body) || '(no text)';
    // writeups list their footnotes at the end under a heading; windows show each one in a popup
    const notes = p.writeup ? body.replace(/^(\[\^[^\]]+\]:)/m, 'Bibliography:\n\n$1') : body;
    return p.headings?.length ? `### (a random heading from the ${p.name} headings list at the end)\n\n${notes}` : notes;
  };
  const randoms = [...new Set(pages.flatMap((p) => [...p.body.matchAll(/\{random:([\w-]+)\}/g)].map((m) => m[1])))].sort();
  for (const name of randoms) lists.set(name, await readLines(`${name}.txt`));

  const map = pages.map((p) => `- [${p.title || p.name}](${p.url})`).join('\n');
  const content = pages.map((p) => `## ${p.title || p.name}\n\n${p.url}\n\n${text(p)}`).join('\n\n');
  const extras = [...lists].map(([name, lines]) => `### ${name}\n\n${lines.map((line) => `- ${line}`).join('\n')}`).join('\n\n');
  return `# errr.in\n\n> ${description}\n\n`
    + 'erin\'s personal site. the home page shows one window at a time, and links like #about open the others.\n\n'
    + `## pages\n\n${map}\n\n${content}\n\n## random picks\n\nsome text on the site is picked at random on each visit, from these lists.\n\n${extras}\n`;
}
