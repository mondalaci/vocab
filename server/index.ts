import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadConfig, type VocabConfig } from './config.js'
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
import { describeDirection, guessDirection, type Direction } from './direction.js'
import { imageBytes, lookupImage } from './images.js'
import { buildMessages, type Turn } from './prompt.js'
import { ChatError, streamChat } from './chat.js'
import { SpeechError, cacheDir, synthesize } from './tts.js'
import { detectPlayer, playOnHost, stopPlayback } from './audio.js'

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = path.join(projectRoot, 'dist')

const loaded = await loadConfig()
const config: VocabConfig = loaded.config
openDatabase(config)

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

const NL = String.fromCharCode(10)

/** The overlay is a single person on one machine, so this is a brake, not a wall. */
const hits = new Map<string, number[]>()
function allowRequest(ip: string | undefined, perMinute = 40): boolean {
  const key = ip ?? 'local'
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((at) => now - at < 60_000)
  if (recent.length >= perMinute) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}

function fail(res: express.Response, status: number, error: string): void {
  res.status(status).json({ error })
}

function titleFrom(text: string): string {
  const first = text.trim().split(NL)[0] ?? text
  const clipped = first.replace(/^["'([{]+|["')\]}.,!?]+$/g, '').trim()
  return clipped.length > 60 ? `${clipped.slice(0, 57)}…` : clipped
}

function speechStatus() {
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

app.get('/api/status', (_req, res) => {
  res.json({
    model: config.openrouter.model,
    hotkey: config.hotkey,
    hasApiKey: Boolean(config.openrouter.apiKey),
    direction: describeDirection('en-hu', config.languages),
    languages: config.languages,
    images: { enabled: config.images.enabled, wiki: config.images.wiki },
    tts: speechStatus(),
    database: pathOfDatabase(),
    configFile: loaded.file,
    usingDefaults: loaded.usingDefaults,
    counts: stats(),
    version: process.env.npm_package_version ?? null,
  })
})

app.get('/api/sessions', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : ''
  res.json({ sessions: listSessions(query) })
})

app.get('/api/sessions/:id', (req, res) => {
  const id = req.params.id
  const found = typeof id === 'string' ? getSession(id) : undefined
  if (!found) {
    fail(res, 404, 'No such session.')
    return
  }
  res.json({
    session: found.session,
    messages: found.messages,
    image: found.session.imageUrl
      ? {
          src: `/api/image?term=${encodeURIComponent(found.session.imageUrl)}`,
          credit: found.session.imageCredit,
          title: found.session.term,
        }
      : null,
  })
})

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id
  const removed = typeof id === 'string' ? deleteSession(id) : false
  res.json({ ok: removed })
})

app.post('/api/sessions/:id/direction', (req, res) => {
  const id = typeof req.params.id === 'string' ? req.params.id : ''
  const direction = req.body?.direction === 'hu-en' ? 'hu-en' : 'en-hu'
  if (!getSession(id)) {
    fail(res, 404, 'No such session.')
    return
  }
  updateSession(id, { direction })
  res.json({ ok: true, direction })
})

app.post('/api/chat', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  const requested = typeof req.body?.sessionId === 'string' ? req.body.sessionId : ''
  const forced = req.body?.direction === 'hu-en' || req.body?.direction === 'en-hu'
    ? (req.body.direction as Direction)
    : undefined

  if (!text) {
    fail(res, 400, 'Nothing to look up.')
    return
  }
  if (text.length > 800) {
    fail(res, 413, 'Too long for a look-up. Keep it to a word or a sentence.')
    return
  }
  if (!allowRequest(req.ip)) {
    fail(res, 429, 'Slow down a little.')
    return
  }

  let sessionId = requested
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
    const image = await lookupImage(config, term)
    const id = randomUUID()
    createSession({
      id,
      title: term,
      direction,
      term,
      imageUrl: image?.remoteUrl ?? null,
      imageCredit: image?.credit ?? null,
    })
    sessionId = id
  }

  const stored = getSession(sessionId)
  if (!stored) {
    fail(res, 500, 'Could not open the session.')
    return
  }
  const history: Turn[] = stored.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  history.push({ role: 'user', content: text })
  addMessage(sessionId, 'user', text)
  const userMessageId = getSession(sessionId)?.messages.at(-1)?.id ?? null

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (payload: unknown) => {
    if (!res.writableEnded) res.write('data: ' + JSON.stringify(payload) + NL + NL)
  }
  const abort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  const heartbeat = setInterval(() => res.write(': ping' + NL), 15_000)

  try {
    send({
      type: 'meta',
      sessionId,
      direction,
      term,
      fresh,
      userMessageId,
      image: stored.session.imageUrl
        ? {
            src: `/api/image?term=${encodeURIComponent(term ?? '')}`,
            credit: stored.session.imageCredit,
            title: term,
          }
        : null,
    })
    let answer = ''
    const result = await streamChat(
      config,
      buildMessages(config, direction, history),
      {
        onDelta: (chunk) => {
          answer += chunk
          send({ type: 'delta', text: chunk })
        },
      },
      abort.signal,
    )
    if (answer.trim()) addMessage(sessionId, 'assistant', answer)
    send({ type: 'done', usage: result.usage, model: result.model })
  } catch (error) {
    if (!abort.signal.aborted) {
      const known = error instanceof ChatError
      console.error('[chat]', error)
      send({
        type: 'error',
        status: known ? error.status : 500,
        message: known ? error.message : 'The look-up failed. Check the server log.',
      })
    }
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// A picture for the headword, fetched from Wikipedia once and then served from
// disk, so the overlay keeps working offline and never hotlinks.
app.get('/api/image', async (req, res) => {
  const term = typeof req.query.term === 'string' ? req.query.term.trim() : ''
  if (!term) {
    fail(res, 400, 'Which term?')
    return
  }
  const image = await lookupImage(config, term)
  if (!image) {
    fail(res, 404, 'No picture for that one.')
    return
  }
  const bytes = await imageBytes(image.remoteUrl)
  if (!bytes) {
    fail(res, 502, 'The picture could not be fetched.')
    return
  }
  res.setHeader('Content-Type', bytes.contentType)
  res.setHeader('Cache-Control', 'public, max-age=604800')
  res.send(bytes.bytes)
})

app.get('/api/tts/:file', (req, res) => {
  const raw = req.params.file
  const name = path.basename(typeof raw === 'string' ? raw : '')
  if (!/^[a-f0-9]{16}\.wav$/.test(name)) {
    fail(res, 400, 'Bad clip name.')
    return
  }
  const file = path.join(cacheDir(), name)
  if (!fs.existsSync(file)) {
    fail(res, 404, 'No such clip.')
    return
  }
  res.setHeader('Content-Type', 'audio/wav')
  res.setHeader('Cache-Control', 'private, max-age=604800')
  fs.createReadStream(file).pipe(res)
})

app.post('/api/speak/stop', (_req, res) => {
  res.json({ ok: true, stopped: stopPlayback() })
})

app.post('/api/speak', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
  const voice = typeof req.body?.voice === 'string' ? req.body.voice : undefined
  const instructions =
    typeof req.body?.instructions === 'string' ? req.body.instructions : undefined

  if (!text) {
    fail(res, 400, 'Nothing to say.')
    return
  }
  if (text.length > 1200) {
    fail(res, 413, 'Too long to speak. Hand it a word or a sentence.')
    return
  }
  if (!allowRequest(req.ip)) {
    fail(res, 429, 'Slow down a little.')
    return
  }

  try {
    const speech = await synthesize(config, text, { voice, instructions })
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
    res.json({
      ok: true,
      audio: `/api/tts/${name}`,
      file: name,
      bytes: speech.bytes,
      cached: speech.cached,
      model: speech.model,
      voice: speech.voice,
      playedOnHost,
      player,
      playError,
    })
  } catch (error) {
    console.error('[speak]', error)
    const known = error instanceof SpeechError
    res.status(known ? error.status : 502).json({
      error: known ? error.message : 'Speech synthesis failed. Check the server log.',
    })
  }
})

const hasBuild = fs.existsSync(path.join(distDir, 'index.html'))
if (hasBuild) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
}
app.use((req, res) => {
  if (req.method !== 'GET') {
    fail(res, 404, 'Not found')
    return
  }
  if (hasBuild) {
    res.sendFile(path.join(distDir, 'index.html'))
    return
  }
  res
    .status(503)
    .type('html')
    .send(
      '<!doctype html><meta charset="utf-8"><title>vocab</title>' +
        '<body style="background:#000;color:#ddd;font:16px system-ui;padding:2rem">' +
        '<p>No build yet. Run <code>npm run build</code> (or <code>npm run dev</code> for the dev server).</p>',
    )
})

const server = app.listen(config.server.port, config.server.host, () => {
  const address = `${config.server.host}:${config.server.port}`
  const lines = [
    '',
    '  vocab is running',
    `  api      http://${address}`,
    `  model    ${config.openrouter.model}`,
    `  hotkey   ${config.hotkey}`,
    `  speech   ${config.tts.model} (${config.tts.voice}) -> ${config.tts.playOnHost ? 'this machine' : 'nowhere'}`,
    `  images   ${config.images.enabled ? `${config.images.wiki}.wikipedia.org` : 'off'}`,
    `  database ${pathOfDatabase()}`,
    `  config   ${loaded.file}${loaded.usingDefaults ? ' (missing, using config.example.mjs)' : ''}`,
  ]
  if (!config.openrouter.apiKey) {
    lines.push('', '  ! no OpenRouter API key — add openrouter.apiKey to config.mjs')
  }
  lines.push('', `  overlay  npm run overlay   (Ctrl+Alt+Shift+F12 by default)`, '')
  console.log(lines.join('\n'))
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
