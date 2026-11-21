import { reactive, watch } from 'vue'

const KEY = 'vocab.overlay.v1'
/** Where these settings lived before the app was renamed from "translator". */
const LEGACY_KEY = 'translator.overlay.v1'

export interface Settings {
  /** Voice override; empty means the voice from config.mjs. */
  voice: string
  /** Ask for a related picture on the first turn. */
  images: boolean
  /** Play the speech on this machine instead of only the phone. */
  playOnHost: boolean
  /** Read the headword aloud as soon as a look-up starts. */
  autoSpeak: boolean
  /** Hide the overlay when it loses focus. */
  hideOnBlur: boolean
  /** Session reopened on the next launch. */
  lastSessionId: string
}

const DEFAULTS: Settings = {
  voice: '',
  images: true,
  playOnHost: true,
  autoSpeak: false,
  hideOnBlur: false,
  lastSessionId: '',
}

function load(): Partial<Settings> {
  try {
    const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    return JSON.parse(stored ?? '{}') as Partial<Settings>
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
