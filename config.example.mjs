/**
 * vocab configuration.
 *
 * Copy this file to `config.mjs` (git-ignored) and edit it there; the values
 * below are the defaults that apply when a key is missing. Config is a real
 * module, so comments, spreads and computed values all work.
 *
 * @typedef {object} VocabConfig
 */

/** @type {VocabConfig} */
export default {
  /**
   * Global shortcut that shows and hides the overlay. This is an Electron
   * accelerator string, so `<Control>`, `Alt`, `Shift`, `Super` and `F1`-`F24`
   * all work: 'Control+Alt+Shift+F12', 'Super+Slash', 'Control+Shift+Space'.
   */
  hotkey: 'Control+Alt+Shift+F12',

  server: {
    port: 8787,
    /** Loopback only: the overlay runs on this machine, nothing else talks to it. */
    host: '127.0.0.1',
  },

  openrouter: {
    /** Your key. Env: OPENROUTER_API_KEY. */
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4.1-flash',
    temperature: 0.25,
    maxTokens: 1400,
    /** Dictionary work needs almost no thinking budget. */
    reasoning: { effort: 'low', exclude: true },
    appName: 'vocab',
    siteUrl: '',
  },

  /** The two sides of the conversation; direction is detected per message. */
  languages: {
    source: { code: 'en', name: 'English', native: 'English' },
    target: { code: 'hu', name: 'Hungarian', native: 'magyar' },
  },

  database: {
    /** Defaults to <repo>/.data/vocab.db. */
    file: '',
  },

  images: {
    /**
     * A real photo for the headword when one exists, fetched from Wikipedia.
     * Nothing is generated, and abstract words simply come back without one.
     */
    enabled: true,
    /** Wikipedia project to ask: 'en', 'hu', ... */
    wiki: 'en',
    /** Thumbnail width in pixels. */
    width: 640,
    /** Longest edge of the file cached next to the database. */
    cache: true,
  },

  tts: {
    enabled: true,
    /** Speech model on OpenRouter's /audio/speech endpoint. */
    model: 'google/gemini-3.8-flash-tts',
    /** Prebuilt Gemini voice: Kore, Puck, Charon, Zephyr, Fenrir, Leda, ... */
    voice: 'Kore',
    /** Optional delivery direction, e.g. 'calm and clear, slightly slow'. */
    instructions: '',
    /** Gemini returns headerless PCM; this is how it gets a WAV header. */
    pcm: { sampleRate: 24000, channels: 1, bits: 16 },
    /** Play through this machine's speakers rather than nowhere. */
    playOnHost: true,
    /** Force a player; auto-detected (paplay, pw-play, ffplay, mpv, aplay) when empty. */
    player: '',
    cache: true,
  },

  overlay: {
    /** Where the window loads the UI from. Defaults to the local server. */
    url: '',
    /** Dim behind the card, 0..1. */
    scrim: 0.55,
    /** Hide the overlay when it loses focus (handy on a single screen). */
    hideOnBlur: false,
    /** Keep the window out of the taskbar and skip its entry in window lists. */
    skipTaskbar: true,
  },

  chat: {
    /** Turns of history sent back to the model, per request. */
    maxHistory: 40,
    /** Extra instructions appended to the system prompt. */
    extraInstructions: '',
  },
}
