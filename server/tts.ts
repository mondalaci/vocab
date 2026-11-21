import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cacheRoot, type VocabConfig } from './config.js'

/**
 * Speech synthesis through OpenRouter's OpenAI-compatible `/audio/speech`
 * endpoint. Gemini TTS only emits headerless PCM, so the bytes are wrapped in a
 * RIFF/WAVE header here — that is what makes the file playable by `paplay` on
 * the PC and by an <audio> element on the phone.
 */

export interface Speech {
  file: string
  bytes: number
  cached: boolean
  model: string
  voice: string
}

export class SpeechError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SpeechError'
  }
}

export function wavHeader(dataBytes: number, config: VocabConfig): Buffer {
  const { sampleRate, channels, bits } = config.tts.pcm
  const blockAlign = (channels * bits) / 8
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * blockAlign, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bits, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)
  return header
}

export function cacheDir(): string {
  return path.join(cacheRoot(), 'tts')
}

function cacheFile(config: VocabConfig, text: string): string {
  const key = [config.tts.model, config.tts.voice, config.tts.instructions, text].join('\u0000')
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return path.join(cacheDir(), `${hash}.wav`)
}

export async function synthesize(
  config: VocabConfig,
  text: string,
  overrides: { voice?: string; instructions?: string } = {},
): Promise<Speech> {
  if (!config.tts.enabled) throw new SpeechError('Speech is switched off in config.json.', 400)
  if (!config.openrouter.apiKey) {
    throw new SpeechError('No OpenRouter API key, so nothing can be spoken.', 400)
  }

  const voice = overrides.voice || config.tts.voice
  const instructions = overrides.instructions ?? config.tts.instructions
  const file = cacheFile({ ...config, tts: { ...config.tts, voice, instructions } }, text)
  const model = config.tts.model

  if (config.tts.cache && fs.existsSync(file)) {
    const size = fs.statSync(file).size
    return { file, bytes: size, cached: true, model, voice }
  }

  const response = await fetch(`${config.openrouter.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/wav, audio/pcm, audio/*',
      ...(config.openrouter.siteUrl ? { 'HTTP-Referer': config.openrouter.siteUrl } : {}),
      ...(config.openrouter.appName ? { 'X-Title': config.openrouter.appName } : {}),
    },
    body: JSON.stringify({
      model,
      input: text,
      voice,
      response_format: 'pcm',
      ...(instructions ? { instructions } : {}),
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let message = `${response.status} ${response.statusText}`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } | string }
      const detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
      if (detail) message = detail
    } catch {
      if (body) message = body.slice(0, 300)
    }
    throw new SpeechError(message, response.status)
  }

  const pcm = Buffer.from(await response.arrayBuffer())
  if (!pcm.length) throw new SpeechError('The speech model returned no audio.', 502)

  const wav = Buffer.concat([wavHeader(pcm.length, config), pcm])
  // Always written: the player needs a file on disk. `cache: false` only means
  // the next request synthesises again instead of reusing this one.
  fs.mkdirSync(cacheDir(), { recursive: true })
  fs.writeFileSync(file, wav)
  return { file, bytes: wav.length, cached: false, model, voice }
}
