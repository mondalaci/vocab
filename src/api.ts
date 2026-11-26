import type {
  ChatEvent,
  ChatRequest,
  Direction,
  Message,
  SessionDetail,
  SessionSummary,
  SpeakRequest,
  SpeakResult,
  Status,
} from '../shared/protocol'

export type {
  ChatEvent,
  ChatRequest,
  Direction,
  Message,
  SessionDetail,
  SessionSummary,
  SpeakRequest,
  SpeakResult,
  Status,
}

/**
 * The renderer never speaks HTTP to this app any more. Everything goes over the
 * preload bridge to the Electron main process, which owns SQLite, OpenRouter and
 * speech; answers stream back as chat events. There is no server to reach and no
 * port to guess.
 */
declare global {
  interface Window {
    vocab?: {
      invoke<T = unknown>(method: string, payload?: unknown): Promise<T>
      chatStart(payload: ChatRequest, onEvent: (event: ChatEvent) => void): string
      chatCancel(streamId: string): void
    }
  }
}

function bridge(): NonNullable<Window['vocab']> {
  const api = window.vocab
  if (!api) {
    throw new Error(
      'The overlay backend is not available. Start the app with `npm start` (or `npm run dev:overlay`).',
    )
  }
  return api
}

export const api = {
  status: () => bridge().invoke<Status>('status'),
  sessions: (q = '') => bridge().invoke<{ sessions: SessionSummary[] }>('sessions', { q }),
  session: (id: string) => bridge().invoke<SessionDetail>('session', { id }),
  removeSession: (id: string) => bridge().invoke<{ ok: boolean }>('removeSession', { id }),
  setDirection: (id: string, direction: Direction) =>
    bridge().invoke<{ ok: true; direction: string }>('setDirection', { id, direction }),
  speak: (body: SpeakRequest) => bridge().invoke<SpeakResult>('speak', body),
  stopSpeech: () => bridge().invoke<{ ok: true; stopped: boolean }>('stopSpeech'),
}

/** Streams one turn. Resolves on `done`, rejects on `error` or a broken call. */
export function chat(
  body: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let streamId = ''
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => {
      if (streamId) bridge().chatCancel(streamId)
      finish()
    }

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      finish()
      return
    }

    try {
      streamId = bridge().chatStart(body, (event) => {
        if (event.type === 'error') {
          finish(new Error(event.message))
          return
        }
        onEvent(event)
        if (event.type === 'done') finish()
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
