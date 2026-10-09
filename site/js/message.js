(() => {
  for (const form of document.querySelectorAll('.message-box')) {
    const box = form.elements.message;
    const status = form.querySelector('.message-status');
    const send = form.querySelector('button');
    const placeholder = box.placeholder;
    const say = (text) => { status.textContent = text; };
    const fit = () => {
      box.style.height = 'auto';
      box.style.height = `${box.scrollHeight}px`;
    };

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    box.addEventListener('input', () => { say(''); box.placeholder = placeholder; fit(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = box.value.trim();
      if (!message || send.disabled) return;
      send.disabled = true;
      try {
        const res = await fetch('/api/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, website: form.elements.website.value }),
        });
        if (res.ok) {
          box.value = '';
          fit();
          box.placeholder = 'sent, thank you ♡';
          say('');
        } else {
          say(res.status === 429 ? 'that was a lot at once, try again in a bit' : "couldn't send that, try again?");
        }
      } catch {
        say("couldn't send that, try again?");
      }
      send.disabled = false;
    });
  }
})();
