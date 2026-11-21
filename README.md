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
┌───────────────────┐        ┌──────────────────┐        ┌────────────┐
│ Electron overlay  │──────▶ │ express + sqlite │──────▶ │ OpenRouter │
│ (Vue chat window) │◀──SSE──│  .data/*.db      │◀──SSE──│ deepseek   │
└───────────────────┘        └──────────────────┘        └────────────┘
        │                             │
        └── pronounce ──▶ paplay ─────┘  Gemini 3.8 Flash TTS → your speakers
                          │
                          └── picture ──▶ Wikipedia lead image (no AI, no key)
```

- **Overlay** — Electron: one frameless, transparent, always-on-top window that stays hidden until
  the hotkey. `globalShortcut` grabs the key through X11, which is why this works where the various
  "osd" npm packages could not.
- **Chat** — the API server holds the thread, so a follow-up keeps the earlier words in context.
- **Storage** — `node:sqlite`, one file under `.data/`. Sessions survive restarts and are searchable.
- **Speech** — `google/gemini-3.8-flash-tts` through OpenRouter's `/audio/speech`, played locally.
- **Pictures** — the Wikipedia lead image for the headword, fetched once and cached.

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

Two processes, both in `ecosystem.config.cjs`:

| pm2 app | what it is |
| --- | --- |
| `vocab` | the API on `127.0.0.1:8787` |
| `vocab-overlay` | the window, and the hotkey |

```bash
pm2 restart vocab vocab-overlay   # after a config change or a rebuild
pm2 logs vocab-overlay            # shows the hotkey it grabbed, and any load failure
```

## Using the overlay

| Key | Does |
| --- | --- |
| *hotkey* | show / hide the overlay (default `Ctrl+Alt+Shift+F12`) |
| `Enter` | look up / send the follow-up |
| `Shift+Enter` | newline |
| `P` | say the session's word out loud |
| `Ctrl+K` | session list |
| `Ctrl+N` | new session |
| `Esc` | stop a running look-up, else leave a panel, else hide |
| click any **bold** word | hear *that word* — the initial word, a follow-up's new word, either side of a `vs` |

**Pronunciations.** Every word the model translates is bold, and each bold word is its own button.
Nothing reads the whole answer aloud — a paragraph of TTS is noise when you want one word.

**Follow-ups.** The thread keeps its direction and its history, so `vs haste`, `in what context`, or
`give me three collocations` land where you expect. A later turn that introduces a new word gets the
full treatment: IPA, senses, examples.

**Pictures.** The first turn of a session asks Wikipedia for the article's lead image. Concrete words
(`water`, `liquid`) come back with a photo; abstract ones (`haste`, `fast`) have no article image and
simply show none — nothing is generated, and a wrong picture is worse than no picture.

## Configuration (`config.mjs`)

`config.mjs` is git-ignored runtime configuration and a real ES module, so comments and computed
values work. Missing keys fall back to `config.example.mjs`.

| Key | Default | Meaning |
| --- | --- | --- |
| `hotkey` | `Control+Alt+Shift+F12` | Any Electron accelerator: `Super+Slash`, `Control+Shift+Space`, … |
| `server.port` / `server.host` | `8787` / `127.0.0.1` | Loopback only — nothing off this machine talks to it. |
| `openrouter.apiKey` | `""` | Your key. Env: `OPENROUTER_API_KEY`. |
| `openrouter.model` | `deepseek/deepseek-v4.1-flash` | Any chat model. |
| `openrouter.temperature` / `maxTokens` | `0.25` / `1400` | Dictionary work wants low temperature and short answers. |
| `languages.source` / `languages.target` | English / Hungarian | The two sides; the labels in the window come from here. |
| `images.enabled` / `images.wiki` / `images.width` | `true` / `en` / `640` | Wikipedia project and thumbnail width. |
| `tts.model` / `tts.voice` | `google/gemini-3.8-flash-tts` / `Kore` | Speech model and one of Gemini's 30 voices. |
| `tts.instructions` | `""` | Delivery direction, e.g. `calm and clear, slightly slow`. |
| `tts.playOnHost` / `tts.player` | `true` / auto | Play on this machine; force a player instead of detecting one. |
| `chat.maxHistory` | `40` | Turns of transcript sent back to the model. |
| `chat.extraInstructions` | `""` | Appended to the system prompt — the easy way to tune the style. |

Env overrides: `PORT`, `HOST`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`,
`VOCAB_HOTKEY`, `VOCAB_DB`, `VOCAB_CONFIG`, `VOCAB_OVERLAY_URL`.

## Development

```bash
npm run dev            # API on :8787 (tsx watch) + vite on :5180
npm run dev:overlay    # the overlay against the vite dev server
npm run build          # type-check both projects, then build dist/
npm run typecheck      # vue-tsc + tsc, no output
```

```
electron/main.mjs      overlay window, global shortcut, IPC
src/components/        ChatView, MessageCard, SessionPanel, SettingsPanel
src/lib/               markdown, settings, toasts
server/index.ts        routes: chat (SSE), sessions, image, speak
server/prompt.ts       the dictionary prompt — the product lives here
server/db.ts           sqlite schema and queries
server/tts.ts          OpenRouter /audio/speech, PCM → WAV, cache
server/audio.ts        host playback (paplay and friends)
server/images.ts       Wikipedia lead image, cached
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The hotkey does nothing | Another app already owns it — `pm2 logs vocab-overlay` says so. Change `hotkey` in `config.mjs` and restart. |
| The overlay shows a connection error | The API is not up: `pm2 restart vocab`. The window retries every 1.5 s. |
| No window, though the process runs | `ELECTRON_RUN_AS_NODE=1` in the environment makes Electron behave as plain Node. `scripts/overlay.sh` unsets it; do not launch the binary directly. |
| The overlay quits right after starting | Its `userData` and single-instance lock collided with another Electron app. `main.mjs` sets both before `whenReady` — keep it that way. |
| Nothing is heard | `tts.playOnHost` off, or no player installed. Settings shows which one was found. |
| An empty answer card | The stream ended without tokens (usually a server restart mid-request); the card is dropped with a toast. |
| Speech errors with a 400 about formats | Gemini TTS only returns `pcm`; if you point `tts.model` elsewhere, match `tts.pcm` to that model. |

## Security notes

- The API binds to loopback. Nothing leaves this machine except the OpenRouter request and the
  Wikipedia lookup.
- The API key lives in `config.mjs` (git-ignored) or the environment; the renderer never sees it.
- `contextIsolation` is on, Node is off in the renderer, and the preload exposes three methods:
  hide, quit, and the blur preference.

Still available: `deploy/nginx-vocab.localhost.conf` puts the same UI on
`http://vocab.localhost` (port 80 → 8787, loopback-only, `proxy_buffering off` so the answer
still streams), for when a browser tab is more convenient.

## License

MIT — see [LICENSE](LICENSE).
