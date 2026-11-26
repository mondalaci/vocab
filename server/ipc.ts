import type { ChatEvent, ChatRequest, Direction, SpeakRequest } from '../shared/protocol.js'
import type { Service } from './service.js'

/**
 * The IPC surface, written against a tiny transport interface so it stays
 * testable and so this file never has to import Electron itself. The main
 * process supplies the adapter in `electron/main.mjs`.
 */

export interface Sender {
  send(channel: string, data: unknown): void
}

export interface Transport {
  /** A request/response call (`ipcRenderer.invoke`). */
  handle(method: string, handler: (payload: unknown, sender: Sender) => unknown): void
  /** A fire-and-forget message (`ipcRenderer.send`). */
  receive(message: string, handler: (payload: unknown) => void): void
}

function field(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined
  return (payload as Record<string, unknown>)[key]
}

function text(payload: unknown, key: string): string {
  const value = field(payload, key)
  return typeof value === 'string' ? value : ''
}

function status(error: unknown): number {
  const value = field(error, 'status')
  return typeof value === 'number' && Number.isInteger(value) ? value : 500
}

export function registerApi(transport: Transport, service: Service): void {
  /** Only streams that the renderer started; abort needs to find them again. */
  const running = new Map<string, AbortController>()

  transport.handle('status', () => service.status())

  transport.handle('sessions', (payload) => service.sessions(text(payload, 'q')))

  transport.handle('session', (payload) => {
    const found = service.session(text(payload, 'id'))
    if (!found) throw new Error('No such session.')
    return found
  })

  transport.handle('removeSession', (payload) => ({
    ok: service.removeSession(text(payload, 'id')),
  }))

  transport.handle('setDirection', (payload) => {
    const direction: Direction = field(payload, 'direction') === 'hu-en' ? 'hu-en' : 'en-hu'
    const id = text(payload, 'id')
    if (!service.setDirection(id, direction)) throw new Error('No such session.')
    return { ok: true, direction }
  })

  transport.handle('stopSpeech', () => ({ ok: true, stopped: service.stopSpeech() }))

  transport.handle('speak', async (payload) => {
    const request: SpeakRequest = {
      text: text(payload, 'text'),
      voice: text(payload, 'voice') || undefined,
      instructions: text(payload, 'instructions') || undefined,
    }
    return service.speak(request)
  })

  transport.handle('chat', async (payload, sender) => {
    const streamId = text(payload, 'streamId')
    const abort = new AbortController()
    if (streamId) running.set(streamId, abort)

    const emit = (event: ChatEvent) => {
      if (streamId) sender.send('chat:event', { streamId, event })
    }

    try {
      const request: ChatRequest = {
        text: text(payload, 'text'),
        sessionId: text(payload, 'sessionId') || undefined,
        direction:
          field(payload, 'direction') === 'hu-en' || field(payload, 'direction') === 'en-hu'
            ? (field(payload, 'direction') as Direction)
            : undefined,
      }
      await service.chat(request, emit, abort.signal)
    } catch (error) {
      // A renderer that pressed Stop is not an error worth reporting back.
      if (!abort.signal.aborted) {
        if (status(error) >= 500) console.error('[chat]', error)
        emit({
          type: 'error',
          status: status(error),
          message: error instanceof Error ? error.message : 'The look-up failed.',
        })
      }
    } finally {
      if (streamId) running.delete(streamId)
    }
  })

  transport.receive('chat:abort', (payload) => {
    const streamId = text(payload, 'streamId')
    if (streamId) running.get(streamId)?.abort()
  })
}
