/**
 * Which way round is this message? Hungarian has enough fingerprints — its
 * digraphs, its diacritics and a handful of very common words — that a cheap
 * score beats spending a model call on the question. Text with no fingerprint
 * at all falls back to the left side of the pair — the language the user put
 * first — and the overlay shows a direction pill they can flip in one click,
 * so a wrong guess is never more than a tap away.
 */

import type { Direction } from '../shared/protocol.js'

export type { Direction }

export interface Guess {
  direction: Direction
  confidence: 'high' | 'low'
  reason: string
}

/** Only Hungarian uses these two. */
const HUNGARIAN_ONLY = /[őű]/i
/** Shared with other languages, so they count for less. */
const HUNGARIAN_DIACRITICS = /[áéíóöúü]/i

const HUNGARIAN_WORDS = new Set([
  'a', 'az', 'egy', 'es', 'és', 'van', 'vannak', 'nem', 'hogy', 'mit', 'mi', 'ez', 'azt',
  'jelentese', 'jelentése', 'magyarul', 'angolul', 'szo', 'szó', 'kifejezes', 'kifejezés',
  'forditas', 'fordítás', 'pelda', 'példa', 'monat', 'mondat', 'ige', 'fonev', 'főnév',
  'melleknev', 'melléknév', 'hatarozo', 'határozó', 'szleng', 'miben', 'miert', 'miért',
  'kulonbseg', 'különbség', 'hogyan', 'hasznalat', 'használat', 'vagy', 'de', 'is', 'meg', 'még',
])

const HUNGARIAN_SUFFIXES = [
  'ban', 'ben', 'bol', 'ból', 'ből', 'nak', 'nek', 'val', 'vel', 'ert', 'ért',
  'hoz', 'hez', 'höz', 'ig', 'kent', 'ként', 'ul', 'ül', 'ok', 'ek', 'ök',
  'ak', 'ek', 'ja', 'je', 'sag', 'ság', 'seg', 'ség', 'tat', 'tet', 'at', 'et', 'ot',
]

/**
 * English words that carry a diacritic, so a lone accented word is not
 * automatically Hungarian. Everything else with á/é/í/ó/ö/ú/ü is.
 */
const ENGLISH_WITH_DIACRITICS = new Set([
  'cafe', 'cafés', 'café', 'résumé', 'resume', 'cliché', 'cliche', 'naïve', 'naive',
  'jalapeño', 'jalapeno', 'piñata', 'pinata', 'façade', 'facade', 'élite', 'elite',
  'fête', 'soirée', 'doppelgänger', 'uber', 'über', 'crème', 'crêpe', 'crepe',
  'entrée', 'puree', 'purée', 'soufflé', 'souffle', 'protegé', 'protégé', 'déjà',
])

const HUNGARIAN_DIGRAPHS = ['sz', 'gy', 'ny', 'ty', 'zs', 'cs', 'ly', 'dj', 'gj', 'nj', 'tj']

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter(Boolean)
}

export function guessDirection(text: string, fallback: Direction = 'en-hu'): Guess {
  const trimmed = text.trim()
  if (!trimmed) return { direction: fallback, confidence: 'low', reason: 'empty' }

  const tokens = words(trimmed)
  const joined = tokens.join(' ')
  let score = 0
  const reasons: string[] = []

  if (HUNGARIAN_ONLY.test(trimmed)) {
    score += 4
    reasons.push('ő/ű')
  }
  if (HUNGARIAN_DIACRITICS.test(trimmed)) {
    // English has a handful of accented loanwords; nothing else with an accent
    // in a single word is likely to be English.
    const accented = tokens.filter((token) => HUNGARIAN_DIACRITICS.test(token))
    const loanwords = accented.filter((token) => ENGLISH_WITH_DIACRITICS.has(token))
    if (accented.length > loanwords.length) {
      score += 3
      reasons.push('diacritics')
    }
  }

  const stopwords = tokens.filter((token) => HUNGARIAN_WORDS.has(token))
  if (stopwords.length) {
    score += Math.min(4, stopwords.length * 2)
    reasons.push(`words:${stopwords.slice(0, 3).join(',')}`)
  }

  for (const token of tokens) {
    if (token.length < 5) continue
    if (HUNGARIAN_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
      score += 1
      reasons.push(`suffix:${token}`)
      break
    }
  }

  if (tokens.length === 1 && !HUNGARIAN_DIACRITICS.test(trimmed)) {
    const token = tokens[0] ?? ''
    const digraphs = HUNGARIAN_DIGRAPHS.filter((pair) => token.includes(pair)).length
    // 'shot', 'fish', 'cash' would hit these too, so this can only nudge.
    if (digraphs >= 2 && token.length >= 6) {
      score += 1
      reasons.push('digraphs')
    }
  }

  // A phrase with no Hungarian marks at all is almost certainly English, but
  // when the left side of the pair is Hungarian the user's chosen side wins: a
  // message that could be either language belongs to the side they put first.
  if (!HUNGARIAN_DIACRITICS.test(trimmed) && !HUNGARIAN_ONLY.test(trimmed) && !stopwords.length) {
    if (tokens.length >= 3 && fallback === 'en-hu') {
      return { direction: 'en-hu', confidence: 'high', reason: 'plain english phrase' }
    }
  }

  if (score >= 3) return { direction: 'hu-en', confidence: score >= 4 ? 'high' : 'low', reason: reasons.join(' ') }
  if (score === 0) {
    // Nothing in the text points either way, so the left side decides.
    return {
      direction: fallback,
      confidence: fallback === 'en-hu' ? 'high' : 'low',
      reason: fallback === 'en-hu' ? 'ascii' : 'left side',
    }
  }
  return { direction: 'en-hu', confidence: 'low', reason: reasons.join(' ') }
}

export function otherDirection(direction: Direction): Direction {
  return direction === 'en-hu' ? 'hu-en' : 'en-hu'
}

/** 'en-hu' with the configured names, for labels like "English ↔ magyar". */
export function describeDirection(
  direction: Direction,
  sides: { source: { native: string }; target: { native: string } },
): string {
  return direction === 'en-hu'
    ? `${sides.source.native} ↔ ${sides.target.native}`
    : `${sides.target.native} ↔ ${sides.source.native}`
}
