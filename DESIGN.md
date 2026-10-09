# errr.in

Source for errr.in. Windows float on a dark page, glow, and dissolve at the edges, and the
whole page is recolored through a gradient map.

## Running it

```
npm install
npm run dev              # http://localhost:5173, add ?tune for the tuning panel
npm run dev -- --lan     # also reachable from a phone on the same network
npm run build            # writes the site to dist/
npm run preview          # remakes site/media/preview.png (needs the dev server running)
npm run deploy -- user@host:/var/www/errr/site
```

The dev server only accepts saves from the computer it runs on. It writes `settings.json`
and `palettes/*.json` and nothing else.

## Content

Everything you edit is in `content/`.

- `content/windows/<name>.md` is a window on the home page. `[text](#name)` opens it from
  another window, and `errr.in/#name` opens it directly.
- `content/writeups/<name>.md` is a full page at `/writeups/<name>/`.
- `content/description.txt` is the one-line description used by search engines and link
  previews.
- `content/404.md` is the window shown for an address that doesn't exist.

Settings go at the top of a file, between `---` lines:

```
---
title: about
width: fit
---
```

- `title`: the tab title. Defaults to the first heading.
- `open: true`: the window shows when the page loads.
- `place: center`: center the window instead of offsetting it from its opener.
- `width`: in px (default 360), or `fit` to size the window to its text.
- `max-width`: with `width: fit`, the widest it gets (default 640).
- `height`: in px. Leave it out to fit the content.
- `description`: writeups only. Replaces `description.txt` for that page.

Other things you can write:

- Random headings: put one per line in `<name>.headings.txt` next to the window's file.
  A visitor never gets the same one twice in a row.
- Footnotes: `a claim[^smith]`, and anywhere below, `[^smith]: the source.` In a window,
  the note shows in a popup in the top left. Writeups also list them at the end.
- Images: put the file in `site/media/` and write `![alt](/media/file.jpg)`. Images are
  recolored through the gradient map.
- Logos: `{icon:github}` inserts `site/media/icons/github.svg` in the text color. The
  current ones come from Simple Icons (CC0). Any one-color SVG works.
- Copy links: `[rukoaraba](copy:rukoaraba)` copies the text when clicked.
- Links to other sites open in a new tab.

## How it works

### Drawing

`site/js/renderer.js` draws the page with WebGL in one shader. It builds a grayscale image
(black page, window halos, faded window edges, text) and then looks up each gray level
in a 256-color ramp made from the palette.

- Halos are blurred rounded rectangles, computed per pixel with Evan Wallace's method
  (madebyevan.com/shaders/fast-rounded-rectangle-shadows).
- Window text, logos and images are copied from the page into textures. The real text
  stays on the page, invisible, so selecting text, links and screen readers still work.
- Where windows overlap, their halos add up, so stacks get brighter.
- Text is drawn once more on top, sharp, so it stays readable through the fade.
- Clicking drops a ripple that spreads across the page. It is turned off for reduced
  motion.
- Without WebGL or JavaScript, CSS draws plain windows in the palette's colors.

An SVG filter version came first. It ran at 3 to 22 fps on an iPhone, and the WebGL
version holds 60 fps.

### Palettes

- `settings.json` holds every tunable value, including the default palette.
- Each file in `palettes/` is a preset. Every visit picks one at random before anything
  is drawn. With `?tune`, the page uses the `settings.json` palette instead.
- Text has to reach a minimum contrast against the window (`minContrast`, 4.5:1 by
  default). If the chosen text color doesn't, the nearest palette color that does is
  used. If no palette color does, a darker or lighter shade of the window color is used.
- The tab icon is a soft circle in the visit's palette, and phones color the browser bar
  to match the page. Static copies of the icon are made from `settings.json` for anything
  that doesn't run JavaScript.

### Windows

The layout is a setting with three options:

- swap (default): one window at a time, centered. Following a link fades the old window
  out and the new one in, pixel by pixel in the same pattern, so the new window appears
  where the old one has just disappeared.
- pack: windows gather around the one in the middle, each moving to the free spot where
  it touches the most other windows.
- stack: windows open slightly below and to the right of the window that opened them.

Fades don't happen all at once. Each pixel's timing comes from a soft noise pattern mixed
with a sweep in a random direction, new for every fade.

The `<` button goes back to the window that opened the current one. There is no close
button and no dragging. The tab title names the open window, and the home page doesn't
scroll. A window too tall for the screen scrolls inside itself.

### Writeups

A writeup is a normal scrolling page with a text column down the middle. The renderer
treats the column as one tall window, so its sides dissolve into the margins.

## Tuning panel

Open any page with `?tune` on the dev server. It never ships in `dist/`. The ` key hides
it.

- Sliders for the effects, fades, layout, ripple and text contrast, plus a randomize
  button.
- A palette editor, a palette generator (an oklch ramp, or cubehelix after Dave Green),
  and saving, loading and deleting presets.
- Test windows, and a performance test that reports to the dev server's terminal.
- Ctrl+S saves to `settings.json`.

## Deploying

`deploy/errr.in.conf` is an nginx config. It redirects http and www to https://errr.in,
serves `404.html` for missing pages, compresses text files, and caches `/media/` for a
week.

One-time setup on the Ubuntu server, with DNS for errr.in and www.errr.in pointing at it:

1. `sudo apt install nginx certbot python3-certbot-nginx`
2. `sudo certbot certonly --nginx -d errr.in -d www.errr.in`
3. `sudo mkdir -p /var/www/errr && sudo chown $USER /var/www/errr`
4. Copy `deploy/errr.in.conf` to `/etc/nginx/sites-available/errr.in`, link it into
   `sites-enabled/`, remove `sites-enabled/default`, and run
   `sudo nginx -t && sudo systemctl reload nginx`.

After that, `npm run deploy -- user@host:/var/www/errr/site` builds the site, copies it
over ssh, and swaps it in all at once. The previous version is kept in `site.old`.

## Performance

Measured on an iPhone (iOS 18.7) with windows moving constantly:

| windows | SVG filter | WebGL |
|---|---|---|
| 1 | 22 fps | 60 fps |
| 3 | 7 fps | 60 fps |
| 6 | 3 fps | 60 fps |

`dev/bench.js` is an older desktop benchmark from before WebGL and needs updating before
it's useful again.
