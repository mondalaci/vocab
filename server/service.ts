import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectRoot, type Loaded, type VocabConfig } from './config.js'
import {
  addMessage,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  openDatabase,
  pathOfDatabase,
  stats,
  updateSession,
} from './db.js'
import { guessDirection, type Direction } from './direction.js'
import { buildMessages, type Turn } from './prompt.js'
import { streamChat } from './chat.js'
import { cacheDir, synthesize } from './tts.js'
import { detectPlayer, playOnHost, stopPlayback } from './audio.js'
import type {
  ChatEvent,
  ChatRequest,
  SessionDetail,
  SessionSummary,
  SpeakRequest,
  SpeakResult,
  Status,
} from '../shared/protocol.js'

/**
 * Everything the overlay does, with no transport in sight.
 *
 * The Electron main process calls these functions directly and forwards the
 * results over IPC; `server/ipc.ts` is the only place that knows a renderer
 * exists. Keeping the work here is what makes the app one process: there is no
 * HTTP server to start, no port to bind and no static directory to serve.
 */

const NL = String.fromCharCode(10)

export class LookupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'LookupError'
  }
}

function titleFrom(text: string): string {
  const first = text.trim().split(NL)[0] ?? text
  const clipped = first.replace(/^["'([{]+|["')\]}.,!?]+$/g, '').trim()
  return clipped.length > 60 ? `${clipped.slice(0, 57)}…` : clipped
}

function version(): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}

export interface Service {
  status(): Status
  sessions(query?: string): { sessions: SessionSummary[] }
  session(id: string): SessionDetail | undefined
  removeSession(id: string): boolean
  setDirection(id: string, direction: Direction): boolean
  chat(input: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal): Promise<void>
  speak(input: SpeakRequest): Promise<SpeakResult>
  stopSpeech(): boolean
  ttsFile(name: string): string | undefined
}

export function createService(config: VocabConfig, loaded: Loaded): Service {
  openDatabase(config)

  function speechStatus(): Status['tts'] {
    const player = detectPlayer(config.tts.player)
    return {
      enabled: config.tts.enabled,
      model: config.tts.model,
      voice: config.tts.voice,
      instructions: config.tts.instructions,
      playOnHost: config.tts.playOnHost,
      player: config.tts.player || player,
      playerFound: Boolean(player),
      available: config.tts.enabled && Boolean(config.openrouter.apiKey),
    }
  }

  async function chat(
    input: ChatRequest,
    emit: (event: ChatEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (!text) throw new LookupError('Nothing to look up.')
    if (text.length > 800) {
      throw new LookupError('Too long for a look-up. Keep it to a word or a sentence.', 413)
    }

    const forced: Direction | undefined =
      input.direction === 'hu-en' || input.direction === 'en-hu' ? input.direction : undefined

    let sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    let direction: Direction = forced ?? 'en-hu'
    let term: string | null = null
    let fresh = false

    if (sessionId) {
      const existing = getSession(sessionId)
      if (existing) {
        direction = (existing.session.direction as Direction) ?? direction
        term = existing.session.term
      } else {
        sessionId = ''
      }
    }

    if (!sessionId) {
      const guess = guessDirection(text)
      direction = forced ?? guess.direction
      term = titleFrom(text)
      fresh = true
      const id = randomUUID()
      createSession({ id, title: term, direction, term })
      sessionId = id
    }

    const stored = getSession(sessionId)
    if (!stored) throw new LookupError('Could not open the session.', 500)

    const history: Turn[] = stored.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    history.push({ role: 'user', content: text })
    addMessage(sessionId, 'user', text)
    const userMessageId = getSession(sessionId)?.messages.at(-1)?.id ?? null

    emit({
      type: 'meta',
      sessionId,
      direction,
      term,
      fresh,
      userMessageId,
    })

    let answer = ''
    const result = await streamChat(
      config,
      buildMessages(config, direction, history),
      {
        onDelta: (chunk) => {
          answer += chunk
          emit({ type: 'delta', text: chunk })
        },
      },
      signal,
    )
    if (answer.trim()) addMessage(sessionId, 'assistant', answer)
    emit({ type: 'done', usage: result.usage, model: result.model })
  }

  async function speak(input: SpeakRequest): Promise<SpeakResult> {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (!text) throw new LookupError('Nothing to say.')
    if (text.length > 1200) {
      throw new LookupError('Too long to speak. Hand it a word or a sentence.', 413)
    }

    const speech = await synthesize(config, text, {
      voice: input.voice,
      instructions: input.instructions,
    })
    let player: string | null = null
    let playedOnHost = false
    let playError: string | null = null
    if (config.tts.playOnHost) {
      try {
        const playback = await playOnHost(speech.file, config.tts.player)
        player = playback.player
        playedOnHost = true
      } catch (error) {
        playError = error instanceof Error ? error.message : String(error)
      }
    }
    const name = path.basename(speech.file)
    return {
      ok: true,
      audio: `vocab://tts/${name}`,
      file: name,
      bytes: speech.bytes,
      cached: speech.cached,
      model: speech.model,
      voice: speech.voice,
      playedOnHost,
      player,
      playError,
    }
  }

  return {
    status(): Status {
      return {
        model: config.openrouter.model,
        hotkey: config.hotkey,
        hasApiKey: Boolean(config.openrouter.apiKey),
        languages: config.languages,
        tts: speechStatus(),
        database: pathOfDatabase(),
        configFile: loaded.file,
        usingDefaults: loaded.usingDefaults,
        counts: stats(),
        version: version(),
      }
    },

    sessions(query = '') {
      return { sessions: listSessions(query) }
    },

    session(id: string): SessionDetail | undefined {
      const found = getSession(id)
      if (!found) return undefined
      return { session: found.session, messages: found.messages }
    },

    removeSession(id: string): boolean {
      return deleteSession(id)
    },

    setDirection(id: string, direction: Direction): boolean {
      if (!getSession(id)) return false
      updateSession(id, { direction })
      return true
    },

    chat,
    speak,

    stopSpeech(): boolean {
      return stopPlayback()
    },

    ttsFile(name: string): string | undefined {
      if (!/^[a-f0-9]{16}\.wav$/.test(name)) return undefined
      const file = path.join(cacheDir(), name)
      return fs.existsSync(file) ? file : undefined
    },
  }
}
