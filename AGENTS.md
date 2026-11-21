# AGENTS.md

Same rules as the global instructions, plus what is specific to this repo.

## What this is

A bilingual English↔Hungarian dictionary in a hotkey-summoned desktop overlay. An Electron window
(the renderer is Vue 3 + Reka UI) talks to a small Express server that streams OpenRouter chat
completions, stores threads in SQLite, looks up Wikipedia lead images and plays Gemini TTS on this
machine. There is no phone, no PWA and no auth: everything is loopback.

## Commands

```bash
npm run dev            # tsx watch on :8787 + vite on :5180
npm run dev:overlay    # the Electron window against the vite dev server
npm run build          # vue-tsc + tsc --noEmit, then vite build into dist/
npm start              # the API alone
npm run overlay        # the window alone (bash scripts/overlay.sh)
npm run typecheck      # both TS projects, no output
```

Always run `npm run typecheck` (or `npm run build`) before claiming a change works — the SPA and the
server are separate TS projects (`tsconfig.app.json`, `tsconfig.server.json`).

Either restart the pm2 apps (`pm2 restart vocab vocab-overlay`) or use `npm run dev` +
`npm run dev:overlay`. A plain `npm start` does **not** pick up server changes.

## Layout

- `electron/main.mjs` — window, hotkey, IPC. `electron/preload.mjs` — the three bridged methods.
- `src/components/` — `ChatView` (transcript + composer), `MessageCard` (one answer: markdown,
  picture, pronounce chips), `SessionPanel`, `SettingsPanel`.
- `src/lib/` — markdown rendering, settings, toasts.
- `server/` — `index.ts` (routes), `prompt.ts` (the product), `db.ts` (sqlite), `chat.ts` (SSE
  client), `tts.ts` (speech + WAV + cache), `audio.ts` (host playback), `images.ts` (Wikipedia),
  `direction.ts` (EN↔HU detection), `config.ts` (loads `config.mjs`).

## Things that bite

- **`ELECTRON_RUN_AS_NODE` is set on this machine**, in the shell and in the pm2 daemon. With it,
  the Electron binary runs as plain Node: no window, no error. Always launch through
  `scripts/overlay.sh`, which unsets it.
- **The app must set its own `userData` and app name before `whenReady`.** Run as a bare script,
  Electron calls itself "Electron" and shares `~/.config/Electron` with other Electron apps — whose
  single-instance lock then makes this one quit silently on startup.
- **The prompt is the product, and its formatting is load-bearing.** Bold marks exactly the words
  being translated, because the renderer turns every `<strong>` into a pronounce button; a stray bold
  becomes a stray button. Explanations are English in both directions — the user asked for that
  explicitly.
- **`config.mjs`, not `config.json`.** `config.example.mjs` holds the defaults *and* is imported as
  the default layer, so a new key must be added there too.
- **Backticks inside the prompt template literal** in `server/prompt.ts` end the template string and
  break the build. Quote markers with single quotes instead.
- **Gemini TTS only returns headerless PCM** (`response_format: 'pcm'`; `mp3` is a 400), which is why
  `server/tts.ts` writes a RIFF/WAVE header before anything plays or serves the file.
- **Speech plays on the host on purpose.** `tts.playOnHost` shells out to `paplay`/`pw-play`/`ffplay`/
  `mpv`/`aplay`; a new clip kills the previous one, and the spawn has to stay `detached` for the
  process-group kill to work.
- **`req.on('close')` fires once the request body is read** on modern Node, which would abort every
  look-up immediately. Watch `res.on('close')` and check `res.writableEnded` instead.
- **Wikipedia images are the article's lead image or nothing.** Do not add a search fallback: it
  happily returns "Empty table setting" for "fast", and a wrong picture is worse than none.
- Scoped CSS does not reach Reka's Select content — style it with `:deep()`, and never portal a
  Reka popover out of a modal dialog (the pointer-events lock makes it untappable).

## Testing

```bash
TOKEN_FREE=1 curl -s localhost:8787/api/status | python3 -m json.tool
curl -s -N -X POST localhost:8787/api/chat -H 'content-type: application/json' \
  -d '{"text":"liquid"}'          # SSE: meta, delta…, done
curl -s -X POST localhost:8787/api/speak -H 'content-type: application/json' \
  -d '{"text":"liquid"}'          # plays on this machine
```

To prove the audio really leaves the machine, watch the sink while it plays:

```bash
pactl -f json list sink-inputs | python3 -c "import json,sys;print([(i['properties'].get('application.name'), i['sink']) for i in json.load(sys.stdin)])"
```

A `paplay` entry on your default sink is the feature working. `ffprobe .cache/tts/*.wav` should report
`pcm_s16le, 24000 Hz, mono`.

For the overlay itself: `xdotool key ctrl+alt+shift+F12` toggles it, and `xdotool search --name
vocab` finds the window. When clicking something inside it, get the coordinates from the DOM
(load the same page in a browser at the window's CSS size) rather than estimating from a screenshot —
guessing pixels lands on the scrim, which hides the window and looks like a broken click.
