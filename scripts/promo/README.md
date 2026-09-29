# 宣传片渲染器 / Promo renderer

`docs/promo/hogwarts-promo.mp4` is rendered offline, frame by frame, from the real game — no screen
recording, no GPU. Re-render it after the world or the UI changes:

```bash
npm i --no-save playwright-core            # or: export PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs
npx tsx scripts/promo/render.ts            # builds the client, renders, encodes, writes docs/promo/
```

Needs a Chromium (`CHROMIUM=…`, default `/opt/pw-browsers/chromium`) and ffmpeg (`FFMPEG=…`, default the
static binary from `python3 -m pip install imageio-ffmpeg`, else `ffmpeg` on PATH). Captions use Google
Fonts (Ma Shan Zheng, Noto Serif SC, Cinzel), fetched once with `curl` (honours `$HTTPS_PROXY`, retries)
and cached in `data/promo/fonts`; the render refuses to start with half-loaded fonts, and
`--local-fonts` uses the local CJK fonts instead (`fc-list :lang=zh`).

| Option | Default | |
|---|---|---|
| `--fps` | `24` | frame rate |
| `--size` | `1280x720` | frame size (16:9; captions are laid out at 720p and scaled) |
| `--workers` | `2` | browsers rendering shots in parallel (SwiftShader is multi-threaded too; 2 suits 4 cores) |
| `--only castle,duel` | all | render just these shots (frames only, no video) |
| `--every 12` | `1` | look-dev: draw every 12th frame only |
| `--no-video` / `--keep` / `--encode-only` | | stop after the frames / keep `data/promo/frames` / only re-encode kept frames |
| `--local-fonts` | | skip the web fonts (use local CJK fonts) |
| `--resume` | | keep frames already in `data/promo/frames` (an interrupted render picks up where it stopped) |
| `--crf` | `26` | H.264 quality (26 keeps the 44 s film around 12 MB) |

## How it works

| File | |
|---|---|
| `story.ts` | the storyboard: cast, shots (hour, who stands where, creatures, timed kernel calls), camera moves, captions |
| `sim.ts` | stages the cast with the kernel (`enroll`, `gainXp`, `forgeSpell`, `cast` of real `glamour` spells) and records each shot: the kernel ticks at 20 Hz on a virtual clock and every 100 ms the same `{t:'snap'}` message the server broadcasts is written to a tape |
| `inpage.js` | injected before the game's scripts: virtual `performance.now` / `Date.now` / `requestAnimationFrame`, seeded `Math.random`, and a WebSocket stand-in that plays the tape |
| `render.ts` | writes the staged world to `data/promo/world.json`, starts the real server on it (port 8500–8519) for the client and the login gate, drives headless Chromium, screenshots, then cross-fades and encodes |

The page is opened at `/?capture=1`; only then does `client/capture.ts` read `window.__capture` (camera
position, look-at point, field of view, skip-this-frame) inside `client/render.ts`. Everything else is
the unmodified client: the HUD is hidden with CSS, the captions are HTML drawn over the canvas, and "your"
wizard is Colin Creevey, standing just behind the camera so the grass grows where the camera looks.
Each shot is played from 2.5 s before its first frame (not drawn), so shots can go to any browser.

Because the kernel runs on the tape's clock and the page on the virtual one, every render is the same
film at any speed — about 3–4 s per 720p frame on SwiftShader on an idle 4-core box (the committed
film: 1145 frames, 3 browsers, ~2 h wall time on a heavily shared machine).
