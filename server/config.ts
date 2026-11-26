import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

export interface Side {
  code: string
  name: string
  native: string
}

export interface VocabConfig {
  hotkey: string
  openrouter: {
    apiKey: string
    baseUrl: string
    model: string
    temperature: number
    maxTokens: number
    reasoning: { effort: string; exclude: boolean }
    appName: string
    siteUrl: string
  }
  languages: { source: Side; target: Side }
  database: { file: string }
  tts: {
    enabled: boolean
    model: string
    voice: string
    instructions: string
    pcm: { sampleRate: number; channels: number; bits: number }
    playOnHost: boolean
    player: string
    cache: boolean
  }
  overlay: { url: string; scrim: number; hideOnBlur: boolean; skipTaskbar: boolean }
  chat: { maxHistory: number; extraInstructions: string }
}

export interface Loaded {
  config: VocabConfig
  file: string
  /** True when config.mjs was missing and only the example defaults applied. */
  usingDefaults: boolean
}

export function configFile(): string {
  return process.env.VOCAB_CONFIG?.trim() || path.join(projectRoot, 'config.mjs')
}

export function dataDir(): string {
  return path.join(projectRoot, '.data')
}

/** Where synthesised speech clips live. */
export function cacheRoot(): string {
  return path.join(projectRoot, '.cache')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fills in keys the user's config does not mention, from the example config. */
function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override)) {
    const current = out[key]
    out[key] =
      isPlainObject(value) && isPlainObject(current) ? merge(current, value) : value
  }
  return out as T
}

async function importModule(file: string): Promise<Partial<VocabConfig> | undefined> {
  if (!fs.existsSync(file)) return undefined
  // A query string defeats the module cache, so an edited config is picked up.
  const url = `${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`
  const module = (await import(url)) as { default?: Partial<VocabConfig> }
  return module.default
}

function fromEnv(config: VocabConfig): VocabConfig {
  const next = structuredClone(config)
  if (process.env.OPENROUTER_API_KEY) next.openrouter.apiKey = process.env.OPENROUTER_API_KEY
  if (process.env.OPENROUTER_MODEL) next.openrouter.model = process.env.OPENROUTER_MODEL
  if (process.env.OPENROUTER_BASE_URL) next.openrouter.baseUrl = process.env.OPENROUTER_BASE_URL
  if (process.env.VOCAB_HOTKEY) next.hotkey = process.env.VOCAB_HOTKEY
  if (process.env.VOCAB_DB) next.database.file = process.env.VOCAB_DB
  return next
}

export async function loadConfig(): Promise<Loaded> {
  const file = configFile()
  const examplePath = path.join(projectRoot, 'config.example.mjs')
  const defaults = (await importModule(examplePath)) ?? ({} as Partial<VocabConfig>)
  const user = await importModule(file)
  const merged = merge(defaults as VocabConfig, user)
  return {
    config: fromEnv(merged),
    file,
    usingDefaults: !user,
  }
}

export function databaseFile(config: VocabConfig): string {
  return config.database.file?.trim() || path.join(dataDir(), 'vocab.db')
}
