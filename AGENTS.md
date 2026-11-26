# AGENTS.md

Same rules as the global instructions, plus what is specific to this repo.

## What this is

A bilingual English↔Hungarian dictionary in a hotkey-summoned desktop overlay. One Electron process
does everything: the Vue 3 + Reka UI renderer draws the window, and the main process runs the
backend — OpenRouter chat streaming, SQLite threads, Gemini TTS played on this machine. The two
halves talk over IPC; there is no HTTP server, no port and no browser-facing surface at all.

## Commands

```bash
npm run dev            # vite (HMR) + esbuild --watch on the main-process bundle
npm run dev:overlay    # the window against the vite dev server
npm run build          # type-check, vite build into dist/, bundle dist-electron/main.mjs
npm run build:main     # just the main-process bundle (electron/main.mjs + server/**, ESBuild)
npm start              # the app (bash scripts/overlay.sh)
npm run typecheck      # both TS projects, no output
```

Always run `npm run typecheck` (or `npm run build`) before claiming a change works — the renderer and
the main process are separate TS projects (`tsconfig.app.json`, `tsconfig.server.json`).

There is one pm2 app now: `pm2 restart vocab`. `scripts/overlay.sh` rebuilds the main-process bundle
when `electron/`, `server/` or `shared/` is newer than it, so a restart is enough for backend edits.
The renderer build in `dist/` is *not* rebuilt by that: run `npm run build` after touching `src/`.

## Layout

- `electron/main.mjs` — window, hotkey, the `vocab://` protocol, the IPC adapter. Bundled with
  esbuild into `dist-electron/main.mjs` (git-ignored) because it imports the TypeScript modules.
- `electron/preload.mjs` — the bridge: overlay controls plus `invoke`/`chatStart`/`chatCancel`.
- `shared/protocol.ts` — the payload types both sides compile against.
- `src/components/` — `ChatView` (transcript + composer), `MessageCard` (one answer: markdown,
  pronounce chips), `SessionPanel`, `SettingsPanel`.
- `src/lib/` — markdown rendering, settings, toasts.
- `server/` — `service.ts` (status, sessions, chat, speech — transport-free), `ipc.ts` (registers
  those over a tiny transport interface), `prompt.ts` (the product), `db.ts` (sqlite), `chat.ts`
  (OpenRouter stream), `tts.ts` (speech + WAV + cache), `audio.ts` (host playback), `direction.ts`
  (EN↔HU detection), `config.ts` (loads `config.mjs`).

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
- **The renderer is loaded from `vocab://app/`, not `file://`.** Chromium refuses ES module scripts
  over file URLs; a privileged custom scheme (registered *before* `whenReady`, handled after) is what
  makes the Vite build work as a normal origin. Keep `base: './'` in `vite.config.ts`, or the asset
  paths break.
- **Streams are cancelled by id.** Each turn gets a `streamId` in the preload bridge, events are
  tagged with it and `vocab:chat:abort` finds the `AbortController` in `server/ipc.ts`. Never emit
  after an abort: a rejected invoke surfaces in the renderer as a failed look-up toast.
- Scoped CSS does not reach Reka's Select content — style it with `:deep()`, and never portal a
  Reka popover out of a modal dialog (the pointer-events lock makes it untappable).

## Testing

There is no HTTP surface to curl any more. Two useful checks:

```bash
npm run typecheck                      # both TS projects
npm run build:main                     # the main-process bundle still resolves
```

For the backend itself, drive `server/service.ts` directly with `tsx` (see `server/ipc.ts` for the
payload shapes): `createService(loaded.config, loaded)` then `chat({text}, emit, signal)`. A real
look-up costs a model call and writes a session, so delete it afterwards — the database is the live
one under `.data/`.

To prove the audio really leaves the machine, watch the sink while it plays:

```bash
pactl -f json list sink-inputs | python3 -c "import json,sys;print([(i['properties'].get('application.name'), i['sink']) for i in json.load(sys.stdin)])"
```

A `paplay` entry on your default sink is the feature working. `ffprobe .cache/tts/*.wav` should report
`pcm_s16le, 24000 Hz, mono`.

For the overlay itself: `xdotool key ctrl+alt+shift+F12` toggles it, and `xdotool search --name
vocab` finds the window. The window is a framed-by-nothing full-screen surface at the display's scale
(this box: geometry 3840x2100 at position 0,60, so screenshot pixels are 2x CSS — halve them for
layout coordinates and double them for `xdotool mousemove`). A click that misses lands on the scrim
and hides the window, which looks like a broken click.
