(() => {
  if (!document.querySelector('[data-footnote-ref]')) return;

  const popup = document.createElement('aside');
  popup.className = 'cite';
  popup.hidden = true;
  popup.setAttribute('aria-hidden', 'true');
  document.body.append(popup);

  let showing = null, hideTimer = 0, pointerType = 'mouse';

  function show(ref) {
    clearTimeout(hideTimer);
    if (showing === ref) return;
    const note = document.getElementById(decodeURIComponent(ref.hash.slice(1)));
    if (!note) return;
    const copy = note.cloneNode(true);
    copy.querySelectorAll('[data-footnote-backref]').forEach((a) => a.remove());
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    const number = document.createElement('span');
    number.className = 'cite-n';
    number.textContent = `[${ref.textContent}]`;
    copy.firstElementChild?.prepend(number);
    popup.replaceChildren(...copy.childNodes);
    popup.hidden = false;
    showing = ref;
  }
  function hide() {
    popup.hidden = true;
    showing = null;
  }
  const hideSoon = () => { hideTimer = setTimeout(hide, 150); };

  for (const ref of document.querySelectorAll('.win [data-footnote-ref]')) {
    const note = document.getElementById(decodeURIComponent(ref.hash.slice(1)));
    const text = note?.textContent.replace(/↩S*/g, '').trim();
    if (text) ref.setAttribute('aria-label', `note ${ref.textContent}: ${text}`);
  }
  const refAt = (e) => e.target.closest?.('[data-footnote-ref]');

  document.addEventListener('pointerdown', (e) => { pointerType = e.pointerType; }, true);
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && refAt(e)) show(refAt(e)); });
  document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && refAt(e)) hideSoon(); });
  document.addEventListener('focusin', (e) => { if (refAt(e)) show(refAt(e)); });
  document.addEventListener('focusout', (e) => { if (refAt(e)) hideSoon(); });

  document.addEventListener('click', (e) => {
    if (pointerType === 'mouse' && !refAt(e)?.closest('.win')) return;
    const ref = refAt(e);
    if (ref) {
      e.preventDefault();
      show(ref);
    } else if (showing) {
      hide();
    }
  });
})();
