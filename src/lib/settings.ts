import { reactive, watch } from 'vue'

const KEY = 'vocab.overlay.v1'
/** Where these settings lived before the app was renamed from "translator". */
const LEGACY_KEY = 'translator.overlay.v1'

export interface Settings {
  /** Voice override; empty means the voice from config.mjs. */
  voice: string
  /** Play the speech on this machine instead of only the phone. */
  playOnHost: boolean
  /** Read the headword aloud once the look-up's answer arrives. */
  autoSpeak: boolean
  /** Hide the overlay when it loses focus. */
  hideOnBlur: boolean
  /** Session reopened on the next launch. */
  lastSessionId: string
}

const DEFAULTS: Settings = {
  voice: '',
  playOnHost: true,
  autoSpeak: true,
  hideOnBlur: false,
  lastSessionId: '',
}

function load(): Partial<Settings> {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    const parsed = JSON.parse(stored ?? '{}') as Partial<Settings> & { images?: boolean }
    // Settings carried over from the pre-dictionary build still carry an
    // `images` key, and the autoSpeak they saved belonged to the old "speak as
    // soon as the look-up starts" behaviour. Drop both so the new default —
    // say the answer once it arrives — takes effect.
    if ('images' in parsed) {
      delete parsed.images
      delete parsed.autoSpeak
    }
    return parsed
  } catch {
    return {}
  }
}

export const settings = reactive<Settings>({ ...DEFAULTS, ...load() })

watch(
  settings,
  (value) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(value))
    } catch {
      /* ignore private-mode failures */
    }
  },
  { deep: true },
)
