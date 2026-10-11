(() => {
  const stage = document.querySelector('.stage');
  if (!stage || document.body.classList.contains('writeup')) return;
  const WINDOWS = ['intro', 'about', 'miscellanea'];
  const FOLD = [1, 2, 3, 3, 2, 1];

  const el = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text ? { textContent: text } : {});
  const panel = (className, ...children) => {
    const p = el('section', `panel ${className}`.trim());
    p.append(...children);
    return p;
  };
  const windowText = (name) => {
    const txt = stage.querySelector(`.win[data-window="${name}"] .txt`);
    const box = el('div', 'panel-text');
    if (!txt) return box;
    box.append(...[...txt.cloneNode(true).childNodes]);
    box.querySelectorAll('.model, .message-box, .back, .lastfm[hidden], .sect:has(> .log), .log, hr').forEach((n) => n.remove());
    return box;
  };

  const portrait = Object.assign(el('img', 'portrait'), { src: '/media/print-portrait.png', alt: '' });
  const booklet = el('div', 'booklet');
  booklet.setAttribute('aria-hidden', 'true');
  document.body.append(booklet);

  function build() {
    const description = document.querySelector('meta[name="description"]')?.content ?? '';
    const panels = [
      panel('cover', el('p', 'kicker', 'a small folded booklet of'), el('h1', '', 'errr.in'), portrait, el('p', 'tagline', description)),
      ...WINDOWS.map((name) => panel('', windowText(name))),
      panel('back-cover', el('p', '', 'printed from'), el('p', 'url', 'errr.in'), el('p', 'kicker', 'fold along the middle')),
    ];
    const sheets = [];
    for (let i = 0; i < panels.length; i += 2) {
      const sheet = el('div', 'sheet');
      const fold = el('div', 'fold');
      fold.append(...FOLD.map((d) => el('span', `dither-${d}`)));
      sheet.append(panels[i], panels[i + 1] ?? panel('blank'), fold);
      sheets.push(sheet);
    }
    booklet.replaceChildren(...sheets);
  }

  build();
  addEventListener('beforeprint', build);
})();
