import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { cacheRoot, type VocabConfig } from './config.js'
import { cachedImage, rememberImage } from './db.js'

/**
 * A related picture, when there is one to be had for free.
 *
 * Wikipedia's lead image is a real photo of the thing — no generation, no key,
 * no cost — and it answers exactly the way the user described: concrete words
 * ('water') come back with a picture, abstract ones ('serendipity', 'haste')
 * come back with nothing at all, which is the honest answer.
 */

export interface RelatedImage {
  /** Absolute URL on Wikipedia/Wikimedia. */
  remoteUrl: string
  /** Where the picture came from, for the caption's credit link. */
  credit: string
  title: string
}

interface PageImageResponse {
  query?: {
    pages?: {
      title: string
      missing?: boolean
      pageimage?: string
      thumbnail?: { source: string; width: number; height: number }
      pageprops?: { disambiguation?: string }
    }[]
  }
}

const UA = 'vocab/1.0 (personal dictionary; local overlay)'

function apiUrl(config: VocabConfig, params: Record<string, string>): string {
  const query = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'pageimages|pageprops',
    piprop: 'thumbnail|name',
    pithumbsize: String(config.images.width),
    redirects: '1',
    ...params,
  })
  return `https://${config.images.wiki}.wikipedia.org/w/api.php?${query}`
}

async function fetchPages(url: string): Promise<PageImageResponse['query']> {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) throw new Error(`Wikipedia said ${response.status}`)
  return ((await response.json()) as PageImageResponse).query
}

function pick(query: PageImageResponse['query']): RelatedImage | undefined {
  for (const page of query?.pages ?? []) {
    if (page.missing || !page.thumbnail?.source) continue
    // Disambiguation pages are lists of links, never the thing itself.
    if (page.pageprops?.disambiguation !== undefined) continue
    return {
      remoteUrl: page.thumbnail.source,
      credit: page.pageimage
        ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`
        : 'https://www.wikipedia.org',
      title: page.title,
    }
  }
  return undefined
}

/** Wikipedia first; if the article has no picture, the best search hit's article. */
export async function lookupImage(
  config: VocabConfig,
  term: string,
): Promise<RelatedImage | undefined> {
  if (!config.images.enabled) return undefined
  const cleaned = term.trim()
  if (!cleaned || cleaned.split(/\s+/).length > 4) return undefined

  const cached = cachedImage(cleaned)
  if (cached) {
    return cached.url
      ? { remoteUrl: cached.url, credit: cached.credit ?? '', title: cleaned }
      : undefined
  }

  try {
    const direct = pick(await fetchPages(apiUrl(config, { titles: cleaned })))
    if (direct) {
      rememberImage(cleaned, direct.remoteUrl, direct.credit)
      return direct
    }
    // No exact article with a picture — which is the honest answer for abstract
    // words. Searching would happily return 'Empty table setting' for 'fast',
    // and a wrong picture is worse than none, so this is deliberately the end.
    rememberImage(cleaned, null, null)
    return undefined
  } catch {
    return undefined
  }
}

export function imageCacheDir(): string {
  return path.join(cacheRoot(), 'images')
}

function fileFor(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16)
  const extension = path.extname(new URL(url).pathname).slice(0, 5) || '.jpg'
  return path.join(imageCacheDir(), `${hash}${extension}`)
}

/** Downloads on first use, then serves from disk so the overlay works offline. */
export async function imageBytes(
  remoteUrl: string,
): Promise<{ bytes: Buffer; contentType: string } | undefined> {
  const file = fileFor(remoteUrl)
  if (fs.existsSync(file)) {
    return { bytes: fs.readFileSync(file), contentType: contentTypeFor(file) }
  }
  try {
    const response = await fetch(remoteUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return undefined
    const bytes = Buffer.from(await response.arrayBuffer())
    fs.mkdirSync(imageCacheDir(), { recursive: true })
    fs.writeFileSync(file, bytes)
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? contentTypeFor(file),
    }
  } catch {
    return undefined
  }
}

function contentTypeFor(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.webp') return 'image/webp'
  return 'image/jpeg'
}
