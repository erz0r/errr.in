(() => {
  const spots = document.querySelectorAll('.lastfm[data-user][data-key]');
  if (!spots.length) return;
  const REFRESH_MS = 60000;

  const ago = (seconds) => {
    const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) {
      const n = Math.floor(seconds / size);
      if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
    }
    return 'just now';
  };

  async function update(spot) {
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    url.search = new URLSearchParams({
      method: 'user.getrecenttracks', user: spot.dataset.user, api_key: spot.dataset.key, format: 'json', limit: '1',
    });
    try {
      const data = await (await fetch(url)).json();
      const track = [data.recenttracks?.track ?? []].flat()[0];
      if (!track || !/^https:\/\/(www\.)?last\.fm\//.test(track.url)) return;
      const link = Object.assign(document.createElement('a'), {
        href: track.url, textContent: track.name, target: '_blank', rel: 'noopener',
      });
      const artist = track.artist?.['#text'] ?? '';
      const playing = track['@attr']?.nowplaying === 'true';
      const when = playing ? ' right now' : track.date?.uts ? `, ${ago(Date.now() / 1000 - Number(track.date.uts))}` : '';
      spot.replaceChildren(`♫ ${playing ? 'listening to' : 'last listened to'} `, link, ` by ${artist}${when}`);
      spot.hidden = false;
    } catch {}
  }

  const updateAll = () => { if (document.visibilityState === 'visible') spots.forEach(update); };
  updateAll();
  setInterval(updateAll, REFRESH_MS);
  document.addEventListener('visibilitychange', updateAll);
})();
