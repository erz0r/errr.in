# errr.in

source for errr.in. windows float on a dark page, glow, and dissolve at the edges, and the
whole page is recolored through a gradient map.

## running it

```
npm install
npm run dev              # http://localhost:5173, add ?tune for the tuning panel
npm run dev -- --lan     # also reachable from a phone on the same network
npm run build            # writes the site to dist/
npm run preview          # remakes site/media/preview.png (needs the dev server running)
npm run deploy -- user@host:/var/www/errr/site
```

the dev server only accepts saves from the computer it runs on. it writes `settings.json`
and `presets/*.json` and nothing else.

## content

everything you edit is in `content/`.

- `content/windows/<name>.md` is a window on the home page. `[text](#name)` opens it from
  another window, and `errr.in/#name` opens it directly.
- `content/writeups/<name>.md` is a full page at `/writeups/<name>/`.
- `content/description.txt` is the one-line description used by search engines and link
  previews.
- `content/404.md` is the window shown for an address that doesn't exist.

settings go at the top of a file, between `---` lines:

```
---
title: about
width: fit
---
```

- `title`: the tab title. defaults to the first heading.
- `open: true`: the window shows when the page loads.
- `place: center`: center the window instead of offsetting it from its opener.
- `width`: in px (default 360), or `fit` to size the window to its text.
- `max-width`: with `width: fit`, the widest it gets (default 640).
- `height`: in px. leave it out to fit the content.
- `description`: writeups only. replaces `description.txt` for that page.

other things you can write:

- random headings: put one per line in `<name>.headings.txt` next to the window's file.
  a visitor never gets the same one twice in a row.
- footnotes: `a claim[^smith]`, and anywhere below, `[^smith]: the source.` in a window,
  the note shows in a popup in the top left. writeups also list them at the end.
- images: put the file in `site/media/` and write `![alt](/media/file.jpg)`. images are
  recolored through the gradient map.
- logos: `{icon:github}` inserts `site/media/icons/github.svg` in the text color. the
  current ones come from simple icons (cc0). any one-color svg works.
- copy links: `[rukoaraba](copy:rukoaraba)` copies the text when clicked.
- links to other sites open in a new tab.
- last.fm: `{lastfm:erarnard}` shows what that account is playing, or what it last
  played and when. it updates every minute while the page is open. it needs a last.fm api
  key in a file called `lastfm.key` (git ignores it). without the key, nothing shows.
  the key ends up in the page, which is normal for read-only last.fm keys.

## how it works

### drawing

`site/js/renderer.js` draws the page with webgl in one shader. it builds a grayscale image
(black page, window halos, faded window edges, text) and then looks up each gray level
in a 256-color ramp made from the palette.

- halos are blurred rounded rectangles, computed per pixel with evan wallace's method
  (madebyevan.com/shaders/fast-rounded-rectangle-shadows).
- window text, logos and images are copied from the page into textures. the real text
  stays on the page, invisible, so selecting text, links and screen readers still work.
- where windows overlap, their halos add up, so stacks get brighter.
- text is drawn once more on top, sharp, so it stays readable through the fade.
- clicking drops a ripple that spreads across the page. it is turned off for reduced
  motion.
- without webgl or javascript, css draws plain windows in the palette's colors.

an svg filter version came first. it ran at 3 to 22 fps on an iphone, and the webgl
version holds 60 fps.

### presets and palettes

- `settings.json` holds every tunable value: effects, palette, window colors, ripple,
  fades and layout. it is the default.
- each file in `presets/` is a full copy of those settings. every visit picks one at
  random before anything is drawn. with `?tune`, or with no presets, the page uses
  `settings.json` instead.
- text has to reach a minimum contrast against the window (`minContrast`, 4.5:1 by
  default). if the chosen text color doesn't, the nearest palette color that does is
  used. if no palette color does, a darker or lighter shade of the window color is used.
- the tab icon is a soft circle in the visit's palette, and phones color the browser bar
  to match the page. static copies of the icon are made from `settings.json` for anything
  that doesn't run javascript.

### windows

the layout is a setting with three options:

- swap (default): one window at a time, centered. following a link fades the old window
  out and the new one in, pixel by pixel in the same pattern, so the new window appears
  where the old one has just disappeared.
- pack: windows gather around the one in the middle, each moving to the free spot where
  it touches the most other windows.
- stack: windows open slightly below and to the right of the window that opened them.

fades don't happen all at once. each pixel's timing comes from a soft noise pattern mixed
with a sweep in a random direction, new for every fade.

the `<` button goes back to the window that opened the current one. there is no close
button and no dragging. the tab title names the open window, and the home page doesn't
scroll. a window too tall for the screen scrolls inside itself.

### writeups

a writeup is a normal scrolling page with a text column down the middle. the renderer
treats the column as one tall window, so its sides dissolve into the margins.

## tuning panel

open any page with `?tune` on the dev server. it never ships in `dist/`. the ` key hides
it.

- sliders for the effects, fades, layout, ripple and text contrast, plus a randomize
  button.
- presets at the top. load one to set every slider from it, and save writes back to the
  preset you loaded. type a new name to save a new one.
- a palette editor and a palette generator (an oklch ramp, or cubehelix after dave green).
- test windows, and a performance test that reports to the dev server's terminal.
- ctrl+s saves to `settings.json`.

## deploying

`deploy/errr.in.conf` is an nginx config. it redirects http and www to https://errr.in,
serves `404.html` for missing pages, compresses text files, and caches `/media/` for a
week.

one-time setup on the ubuntu server, with dns for errr.in and www.errr.in pointing at it:

1. `sudo apt install nginx certbot python3-certbot-nginx`
2. `sudo certbot certonly --nginx -d errr.in -d www.errr.in`
3. `sudo mkdir -p /var/www/errr && sudo chown $USER /var/www/errr`
4. copy `deploy/errr.in.conf` to `/etc/nginx/sites-available/errr.in`, link it into
   `sites-enabled/`, remove `sites-enabled/default`, and run
   `sudo nginx -t && sudo systemctl reload nginx`.

after that, `npm run deploy -- user@host:/var/www/errr/site` builds the site, copies it
over ssh, and swaps it in all at once. the previous version is kept in `site.old`.

## performance

measured on an iphone (ios 18.7) with windows moving constantly:

| windows | svg filter | webgl |
|---|---|---|
| 1 | 22 fps | 60 fps |
| 3 | 7 fps | 60 fps |
| 6 | 3 fps | 60 fps |

`dev/bench.js` is an older desktop benchmark from before webgl and needs updating before
it's useful again.
