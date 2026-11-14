// shows a notification when erin answers a message sent from this browser. the push itself is
// empty, so this asks /api/message (the browser sends the inbox cookie) for the newest answer.
self.addEventListener('push', (e) => e.waitUntil((async () => {
  let body = 'your message got an answer';
  try {
    const res = await fetch('/api/message', { cache: 'no-store' });
    const latest = (await res.json()).conversations
      .flatMap((c) => c.entries)
      .filter((entry) => entry.from === 'erin')
      .sort((a, b) => b.time.localeCompare(a.time))[0];
    if (latest) body = latest.text.length > 160 ? `${latest.text.slice(0, 159)}…` : latest.text;
  } catch {}
  await self.registration.showNotification('erin replied ♡', { body, tag: 'errr.in-reply', icon: '/apple-touch-icon.png', data: { url: '/#about' } });
})()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (!page) return self.clients.openWindow('/#about');
    await page.focus();
    page.postMessage({ open: 'about' });
  })());
});
