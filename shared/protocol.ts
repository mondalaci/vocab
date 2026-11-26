/**
 * The contract between the Vue renderer and the Electron main process.
 *
 * There is no HTTP server any more: the renderer asks the main process over
 * `ipcRenderer.invoke`, and the answer streams back as `vocab:chat:event`
 * messages tagged with the stream id that started them. Both sides import the
 * types below, so a changed payload cannot drift silently.
 */

export type Direction = 'en-hu' | 'hu-en'

export interface SessionSummary {
  id: string
  title: string
  direction: Direction
  term: string | null
  createdAt: number
  updatedAt: number
  turns: number
}

export interface Message {
  id: number
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

export interface Side {
  code: string
  name: string
  native: string
}

export interface Status {
  model: string
  hotkey: string
  hasApiKey: boolean
  languages: { source: Side; target: Side }
  tts: {
    enabled: boolean
    model: string
    voice: string
    instructions: string
    playOnHost: boolean
    player: string | null
    playerFound: boolean
    available: boolean
  }
  database: string
  configFile: string
  usingDefaults: boolean
  counts: { sessions: number; messages: number }
  version: string | null
}

export interface SpeakRequest {
  text: string
  voice?: string
  instructions?: string
}

export interface SpeakResult {
  ok: true
  /** `vocab://tts/...`; unused by the overlay, kept for anyone else listening. */
  audio: string
  file: string
  bytes: number
  cached: boolean
  model: string
  voice: string
  playedOnHost: boolean
  player: string | null
  playError: string | null
}

export interface SessionDetail {
  session: SessionSummary
  messages: Message[]
}

export interface ChatRequest {
  text: string
  /** Omit for a new conversation; the main process creates the session. */
  sessionId?: string
  direction?: Direction
  /** Filled in by the preload bridge so events can be routed back. */
  streamId?: string
}

export type ChatEvent =
  | {
      type: 'meta'
      sessionId: string
      direction: Direction
      term: string | null
      fresh: boolean
      userMessageId: number | null
    }
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: Record<string, unknown> | null; model: string }
  | { type: 'error'; status: number; message: string }

/** Every invoke channel the renderer may call, minus the `vocab:` prefix. */
export type Method =
  | 'status'
  | 'sessions'
  | 'session'
  | 'removeSession'
  | 'setDirection'
  | 'chat'
  | 'speak'
  | 'stopSpeech'
