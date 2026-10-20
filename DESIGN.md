# errr.in

source for errr.in. windows float on a dark page, glow, and dissolve at the edges, and the
whole page is recolored through a gradient map.

the font is fraunces (sil open font license, `site/media/fonts/`), with its soft axis turned
all the way up.

everything grows with the screen. the root font size is 16px up to about a 1366px wide
window, about 18px at 1080p and at most 24px (150%), and it follows the browser's own text
size setting. sizes in the windows are multiples of `--u` (1/14 of the root size), and the
renderer works in the same units, so glows, edges, popups and boxes scale with the text.
dither dots stay tied to real screen pixels so they stay sharp. text lines stay between
about 55 and 75 characters.

## running it

```
npm install
npm run dev              # http://localhost:5173, add ?tune for the tuning panel
npm run dev -- --lan     # also reachable from a phone on the same network
npm run build            # writes the site to dist/
npm run preview          # draws the link preview image, a big circle in the lavender
                         # preset (or: npm run preview -- <preset name>)
npm run deploy           # builds and puts the site on momoka
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
- `/llms.txt` is made from content/ on every build: the description, a map of every page
  and window (and the 404 page), then the full text of each as the site shows it: footnotes
  nothing points to are left out like they are on the page, the live parts (last.fm, the model,
  the message box, the log) are described in words, and the lists random picks come from (the
  intro's headings, the kaomoji) are at the end. every page links to it in its head and with a
  link nobody sees (no size, not focusable, hidden from screen readers).

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
- `popup: true`: the window opens as a small bubble on top of the window it was opened from,
  just above the link, with a tail pointing at it. everything around it fades to the page
  color. clicking outside or escape closes it.
- `flat: true`: the window runs the full height of the screen with no glow, and only its
  sides dissolve into the page. the about window uses it.

other things you can write:

- random picks: `{random:name}` shows a random line from `content/<name>.txt` on each visit
  (the first line without javascript). the 404 page uses `{random:kaomoji-sad}`, and the about page
  uses `{random:kaomoji-happy}`.
- random headings: put one per line in `<name>.headings.txt` next to the window's file.
  a visitor never gets the same one twice in a row.
- footnotes: `a claim[^smith]`, and anywhere below, `[^smith]: the source.` in a window,
  the note shows in a popup in the top left. writeups also list them at the end.
- images: put the file in `site/media/` and write `![alt](/media/file.jpg)`. images are
  recolored through the gradient map, with their own levels and their own stretch of the map
  (the images section of the panel), so a photo with odd colors can still be made readable.
- boxes: wrap part of a window in `<div class="sect">` (with blank lines inside) to put it on
  a soft box in its own color from the gradient map. `<div class="cols">` around two boxes puts
  them side by side, stacked on phones. the about window has the intro box, then a
  "currently" list next to the log.
- `***` is a dotted line that thins out toward its ends.
- logos: `{icon:github}` inserts `site/media/icons/github.svg` in the text color. the
  current ones come from simple icons (cc0). any one-color svg works.
- copy links: `[rukoaraba](copy:rukoaraba)` copies the text when clicked.
- links to other sites open in a new tab.
- 3d model: `{model:erinsona}` shows `site/media/erinsona.glb` (exported from the `SitIdle` action in
  erinsona_base_v1.blend). after exporting, run `npm run model -- path/to/erinsona.glb`: it drops data
  the model doesn't use (texture coordinates, a second color set), quantizes it and compresses it with
  meshopt, which took it from 2.5 MB to 595 KB. three.js (`site/js/vendor/three.js`, rebuilt with `npm run vendor`)
  renders her off screen and the main renderer draws her through the gradient map, inside
  her window. her body is turned 3/4, her head faces forward and turns a little toward the
  cursor, and her eyes follow it. the model section of the panel sets her levels and light.
  she casts a hard shadow toward the inside of the window, in the darkest color of the
  gradient map (measured along the whole map, so it works when the map starts light).
  her upper body sways a little in the loop, and at random moments she blinks (the Blink
  shape key, sometimes twice) and flicks an ear or both. her scene lives in
  `site/js/model-scene.js`, shared by the live model and the baked loop below.
  each preset sets where she sits, her size, which way she faces, and the sun for her shadow
  (direction, height, darkness). her box has invisible room on every side so a long shadow
  isn't cut off. she draws at 30 fps and at most 1.5x the screen's pixel density, with her
  shadow and body side by side in one canvas so each frame is one copy into the page.
- phones (anything without hover) don't run three.js. there's no cursor for her to follow, so
  they play a loop baked from the same scene: `npm run bake` (needs ffmpeg and
  `npx playwright install chromium`) renders 12 seconds of her (three sways, with blinks and ear
  flicks at fixed times) into `site/media/erinsona-loop-<light>_<fill>_<sun direction>_<sun height>_<turn>.mp4`,
  one per combination used by `settings.json` or a preset. each frame stacks what the renderer
  reads from the live model: her gray, her alpha and her shadow's alpha, so levels and the gradient
  map still apply on the phone. the video plays invisibly in her box and the renderer draws each
  new frame. run it again after changing the model or any of those five settings in a preset;
  until then, phones showing that preset get the live model. `?tune` always gets the live model.
- log: `{log}` shows erin's latest posts (text, time and pictures) from one discord channel,
  newest first. a bot watches the channel (see deploying), and new posts, edits and deletes show
  up on the page within a second. the dev server shows the live log, or the entries in
  `dev/log-sample.json` when it can't reach it.
- message box: `{message-box}` is a text box with a send arrow. enter sends. it sits in its own
  box at the bottom of the about page.
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
- everything that changes the picture asks for a frame, and the page is drawn at most once per
  display frame. a new frame of her redraws only her box (she can't change pixels outside it),
  which is why the canvas keeps its drawing between frames.
- easter egg: three quick clicks or taps on the background start conway's game of life on the page,
  and three more stop it. the first generation is the background's dither dots as they are (a cell
  that rounds up a tone starts alive). live cells sit on the page a tone up, under the halos and
  windows, which keep their own dithering, so the game shows on the bare page and fades out under
  the glows. it runs on underneath the windows too, so things wander behind a window and come out
  the other side. if the page has (almost) no live cells, at the start or later, it gets a few
  patches of random soup. 15 generations a second, on a torus. it fades in and out across the whole
  page through the same noise and sweep as a window's fade, over twice the window fade time.
- clicking drops a ripple that spreads across the page. it is turned off for reduced
  motion.
- while ripples or the game of life run, the windows, glows, boxes and text are drawn once
  into two cache textures, and each ripple or game frame only bends, tones and dithers that
  cache. the gray is kept as `a * life + b` so the game's tone can still go under everything.
  anything else (fades, resizes) draws the whole page directly. this needs the
  `WEBGL_draw_buffers` extension; without it everything draws directly.
- boxes are blurred rectangles worked out per pixel like the halos. their color comes from a
  spot on the gradient map and is dithered against the window, and it fades out under text so
  letters keep clean edges. pictures in the log fade into their box, more at the sides than at
  the top and bottom.
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

### printing

printing the home page gives a folded black and white booklet (`site/js/print.js`): landscape
sheets with two panels and a dithered fold down the middle. a cover with a 1-bit dithered
portrait (`site/media/print-portrait.png`, rendered from the blender file), then intro,
about and miscellanea with their notes printed, then a back cover. writeups print as
plain black text.

## tuning panel

open any page with `?tune` on the dev server. it never ships in `dist/`. the ` key hides
it.

- settings are grouped (colors, glow & edges, dither, windows, about page boxes, images,
  erinsona, ripples, testing). a search box at the top finds a setting by its name, what it
  does or its group. each setting has a one-line explanation, which a checkbox hides. which
  groups are open is remembered.
- on the page, drag erinsona to move her, scroll over her to resize her and shift+scroll to
  turn her.
- sliders for the effects, fades, layout, ripple and text contrast, plus a randomize
  button.
- presets at the top. load one to set every slider from it, and save writes back to the
  preset you loaded. type a new name to save a new one.
- apply changes to all presets copies just the settings you changed since the last load
  or save into every preset. it asks first and lists them.
- a palette editor and a palette generator (an oklch ramp, or cubehelix after dave green).
- dither (experiment, off unless amount is above 0): dithers the gray image under the
  gradient map, so only palette colors show. levels, pixel size, spread and a pattern (bayer
  2/4/8, noise, lines, diagonal) are tunable and saved with presets.
- test windows, and a performance test that reports to the dev server's terminal.
- ctrl+s saves to `settings.json`.

## deploying

the site runs on momoka, a home server, behind its cloudflare tunnel. nothing is
exposed directly and cloudflare handles https.

- `deploy/nginx.conf` is the config for an `nginx:alpine` container called `errrin`.
  it serves `~/errr.in/site`, shows `404.html` for missing pages, compresses text files and
  the 3d model (served as `model/gltf-binary`), and caches `/media/` for a week.
- security headers: a content security policy that only allows the site's own scripts
  (pages have no inline scripts; the preset data is inline but not runnable) plus
  `'wasm-unsafe-eval'`, which lets the model's meshopt decoder compile its webassembly (it does
  not allow `eval`). no
  framing by other sites, nosniff, and no server version. folders and hidden files
  answer 404.
- `deploy/compose.yml` is that container's entry in `~/docker/docker-compose.yml`. it
  mounts `~/errr.in` rather than `~/errr.in/site`, because each deploy swaps the `site`
  folder out and a mount would keep pointing at the old one.
- the tunnel config (`~/docker/cloudflared/config.yml`) sends `errr.in` and
  `www.errr.in` to `http://errrin:80`.
- messages: a second container, `errrin-inbox` (`deploy/inbox.mjs`), saves each message to
  `~/errr.in-inbox/messages.jsonl` and posts it to a discord webhook. the webhook lives in
  `~/docker/errrin/inbox.env` on momoka, never in the repo. nginx allows about 3 messages a
  minute per visitor. `npm run messages` shows them all.
- log: a third container, `errrin-log` (`deploy/log.mjs`, no dependencies), is a discord bot.
  it keeps a gateway connection open and, whenever a message in the log channel is posted,
  edited or deleted, reads the channel again and keeps erin's 15 newest posts. pictures are
  saved to `~/errr.in-log/media`. it serves `/api/log`, the pictures, and `/api/log/stream`,
  which pushes the log to open pages (server-sent events, at most 4 per visitor). it also
  rereads the channel every minute in case the connection drops. the bot token, channel id and
  erin's user id live in `~/docker/errrin/log.env` on momoka, never in the repo. the bot needs
  the message content intent and read access to that channel.
- cloudflare web analytics is allowed by the security policy, for visitor stats.
- www.errr.in redirects to errr.in. the main site is nginx's default server, so any other
  host name gets the site rather than the redirect.
- the build also writes `robots.txt` and `sitemap.xml` (the home page and each writeup).
- every script and stylesheet address carries a version made from its contents
  (`/js/window.js?v=...`), so a deploy is picked up right away even though cloudflare tells
  browsers to keep those files for 4 hours.
- to deploy: `npm run deploy`. it builds, copies the
  site over ssh and swaps it in at once. the previous version stays in `site.old`.

## performance

measured on an iphone (ios 18.7) with windows moving constantly:

| windows | svg filter | webgl |
|---|---|---|
| 1 | 22 fps | 60 fps |
| 3 | 7 fps | 60 fps |
| 6 | 3 fps | 60 fps |

opening the about window on a phone (emulated iphone at 3x, slow 4g, 4x slower cpu), before and
after compressing the model:

| | before | after |
|---|---|---|
| downloaded to show her | 2,625 KB | 537 KB |
| tap to first frame of her | 17 to 18 s | 6 to 8 s |

and with her on screen, on the same emulated phone drawing with an apple m5 gpu (5 seconds of
her animating; the original, then the live model with the per-frame and her-box-only drawing,
then the baked loop phones get):

| | original | live | loop |
|---|---|---|---|
| tap to first frame of her | 14.2 s | 3.4 s | 0.5 s |
| page draws per second | 61 | 61 | 32 |
| screens' worth of pixels shaded per second | 61 | 9 | 7 |
| gpu process busy, ms per second | 24.5 | 25.6 | 13 |
| page main thread busy, ms per second | 51 | about the same | 26 |

on a desktop at 1920×1080 and 2x (a 4k-sized canvas), before and after the ripple cache, her
30 fps cap and her one-copy frames:

| | before | after |
|---|---|---|
| ripples running, gpu ms per second | about 260 | 70 to 100 |
| about window open, gpu ms per second | about 105 | 30 to 45 |
| about window open, main thread busy | 10% | 4% |
| ripples running, main thread busy | 12% | 4% |
