# vocab

A bilingual English↔Hungarian dictionary that lives in a desktop overlay you summon with a hotkey.

Press **Ctrl+Alt+Shift+F12** and a chat window appears over whatever you are doing. Type a word in
either language — the direction is detected — and you get its translation, IPA pronunciation, an
English definition, one sense per line, and examples. Then keep going: `vs haste`, `how formal is
this`, `more examples`. Comparisons are what make nuances stick, and every thread is saved in SQLite.

Built for looking things up *while playing*: the window is pitch black, the answers are short, and
the pronunciation comes out of **this machine's** speakers, so you hear it in the same headphones the
game is using.

![the overlay over the desktop](docs/screenshot-overlay.png)

| Sessions | Settings |
| --- | --- |
| ![session list](docs/screenshot-sessions.png) | ![settings](docs/screenshot-settings.png) |

## How it works

```
  Ctrl+Alt+Shift+F12
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ one Electron process                                │
│                                                     │
│  Vue overlay  ──IPC──▶  main: SQLite, the thread,   │
│  (the window) ◀─events─  OpenRouter, Gemini TTS     │
└─────────────────────────────────────────────────────┘
        │                          │
        └── pronounce ──▶ paplay ──┘ ──▶ your speakers
```

- **Overlay** — Electron: one frameless, transparent, always-on-top window that stays hidden until
  the hotkey. `globalShortcut` grabs the key through X11, which is why this works where the various
  "osd" npm packages could not.
- **No server** — the main process *is* the backend: it owns the database, the model stream and
  speech. The window is loaded from `vocab://app/` (a custom scheme over `dist/`) and talks to it
  over IPC. There is no HTTP listener, no port and no localhost origin to leak.
- **Chat** — the main process holds the thread, so a follow-up keeps the earlier words in context.
- **Storage** — `node:sqlite`, one file under `.data/`. Sessions survive restarts and are searchable.
- **Speech** — `google/gemini-3.8-flash-tts` through OpenRouter's `/audio/speech`, played locally.

## Requirements

- Node.js 22.5+ (for `node:sqlite`) and an **X11** session
- An [OpenRouter](https://openrouter.ai/keys) API key
- An audio player for the pronunciation: `paplay`, `pw-play`, `ffplay`, `mpv` or `aplay`

## Quick start

```bash
git clone https://github.com/mondalaci/vocab.git
cd vocab
npm install
cp config.example.mjs config.mjs    # then put your key in it
npm run build
pm2 start ecosystem.config.cjs      # or: npm start, plus npm run overlay in another terminal
pm2 save
```

OpenRouter key: `openrouter.apiKey` in `config.mjs`, or `OPENROUTER_API_KEY` in the environment.

One pm2 app, `vocab`, and it is the whole program: the window and the backend behind it.

```bash
pm2 restart vocab      # after a rebuild, or after editing a module it imports
pm2 logs vocab         # shows the hotkey it grabbed, and any load failure
```

`scripts/overlay.sh` re-bundles the main process when its sources are newer than
`dist-electron/main.mjs`, so a restart picks up backend edits without a full build.

## Using the overlay

| Key | Does |
| --- | --- |
| *hotkey* | show / hide the overlay (default `Ctrl+Alt+Shift+F12`) |
| `Enter` | start a new translation — a fresh conversation, even mid-thread |
| `Ctrl`+`Enter` / `Shift`+`Enter` | follow-up in the conversation on screen |
| `Alt`+`Enter` | newline in the composer |
| `Alt`+`C` | focus the composer from anywhere in the overlay |
| `Alt`+`S` | say the session's word out loud — press again to stop |
| `Ctrl+K` | session list |
| `Ctrl+N` | new session |
| `Esc` | stop a running look-up, else leave a panel, else hide |
| click any **bold** word | hear *that word* — the initial word, a follow-up's new word, either side of a `vs` |

**Pronunciations.** Every word the model translates is bold, and each bold word is its own button.
Nothing reads the whole answer aloud — a paragraph of TTS is noise when you want one word. With
**Say the word automatically** on (the default), the headword is spoken as soon as the answer arrives.

**Follow-ups.** The thread keeps its direction and its history, so `vs haste`, `in what context`, or
`give me three collocations` land where you expect. A later turn that introduces a new word gets the
full treatment: IPA, senses, examples.

## Configuration (`config.mjs`)

`config.mjs` is git-ignored runtime configuration and a real ES module, so comments and computed
values work. Missing keys fall back to `config.example.mjs`.

| Key | Default | Meaning |
| --- | --- | --- |
| `hotkey` | `Control+Alt+Shift+F12` | Any Electron accelerator: `Super+Slash`, `Control+Shift+Space`, … |
| `openrouter.apiKey` | `""` | Your key. Env: `OPENROUTER_API_KEY`. |
| `openrouter.model` | `deepseek/deepseek-v4.1-flash` | Any chat model. |
| `openrouter.temperature` / `maxTokens` | `0.25` / `1400` | Dictionary work wants low temperature and short answers. |
| `languages.source` / `languages.target` | English / Hungarian | The two sides; the labels in the window come from here. |
| `tts.model` / `tts.voice` | `google/gemini-3.8-flash-tts` / `Kore` | Speech model and one of Gemini's 30 voices. |
| `tts.instructions` | `""` | Delivery direction, e.g. `calm and clear, slightly slow`. |
| `tts.playOnHost` / `tts.player` | `true` / auto | Play on this machine; force a player instead of detecting one. |
| `chat.maxHistory` | `40` | Turns of transcript sent back to the model. |
| `chat.extraInstructions` | `""` | Appended to the system prompt — the easy way to tune the style. |

Env overrides: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`, `VOCAB_HOTKEY`,
`VOCAB_DB`, `VOCAB_CONFIG`, `VOCAB_OVERLAY_URL`.

## Development

```bash
npm run dev            # vite (HMR on :5180) + esbuild watching the main-process bundle
npm run dev:overlay    # the overlay against the vite dev server
npm run build          # type-check, build dist/, bundle dist-electron/main.mjs
npm run typecheck      # vue-tsc + tsc, no output
```

```
electron/main.mjs      window, hotkey, vocab:// scheme, IPC adapter
electron/preload.mjs   the bridge: overlay controls + the backend API
shared/protocol.ts     the payload types both sides compile against
src/components/        ChatView, MessageCard, SessionPanel, SettingsPanel
src/lib/               markdown, settings, toasts
server/service.ts      status, sessions, chat streaming, speech — no transport
server/ipc.ts          registers those over a tiny transport interface
server/prompt.ts       the dictionary prompt — the product lives here
server/db.ts           sqlite schema and queries
server/chat.ts         OpenRouter chat stream
server/tts.ts          OpenRouter /audio/speech, PCM → WAV, cache
server/audio.ts        host playback (paplay and friends)
server/direction.ts    EN ↔ HU detection
server/config.ts       config.mjs loading and defaults
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The hotkey does nothing | Another app already owns it — `pm2 logs vocab-overlay` says so. Change `hotkey` in `config.mjs` and restart. |
| The window is blank, or says "No build yet" | `npm run build`; the app loads `dist/` at startup, so a rebuild needs `pm2 restart vocab` too. |
| No window, though the process runs | `ELECTRON_RUN_AS_NODE=1` in the environment makes Electron behave as plain Node. `scripts/overlay.sh` unsets it; do not launch the binary directly. |
| The overlay quits right after starting | Its `userData` and single-instance lock collided with another Electron app. `main.mjs` sets both before `whenReady` — keep it that way. |
| Nothing is heard | `tts.playOnHost` off, or no player installed. Settings shows which one was found. |
| An empty answer card | The stream ended without tokens (usually the app was stopped mid-request); the card is dropped with a toast. |
| Speech errors with a 400 about formats | Gemini TTS only returns `pcm`; if you point `tts.model` elsewhere, match `tts.pcm` to that model. |

## Security notes

- Nothing listens. The renderer is served from `vocab://app/` out of `dist/` and the backend is
  reached over IPC, so there is no port, no cookie jar and no page another process can dial into.
- The only outbound traffic is the OpenRouter request.
- The API key lives in `config.mjs` (git-ignored) or the environment; the renderer never sees it.
- `contextIsolation` is on, Node is off in the renderer, and the preload exposes the overlay
  controls plus the backend calls — nothing else.

## License

MIT — see [LICENSE](LICENSE).
