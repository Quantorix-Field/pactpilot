/**
 * Finds where a verified quote sits inside a clause's original text, so the interface can
 * draw the highlighter pen on the real words. The server already confirmed the quote exists
 * (ignoring case, spacing and punctuation); this only locates it for rendering.
 */

export interface QuoteRange {
  start: number
  end: number
}

interface Mapped {
  /** Lowercased letters/numbers/marks only, with runs of everything else collapsed to one space. */
  norm: string
  /** norm[i] came from the original string at map[i] (a UTF-16 index, safe to use in .slice()). */
  map: number[]
}

const WORD = /[\p{L}\p{N}\p{M}]/u

function mapText(text: string): Mapped {
  let norm = ''
  const map: number[] = []
  let atSpace = true
  let i = 0
  for (const ch of text) {
    if (WORD.test(ch)) {
      norm += ch.toLowerCase()
      map.push(i)
      atSpace = false
    } else if (!atSpace) {
      norm += ' '
      map.push(i)
      atSpace = true
    }
    i += ch.length
  }
  if (atSpace && norm.length > 0) {
    norm = norm.slice(0, -1)
    map.pop()
  }
  return { norm, map }
}

/** Same normalization, used only to build the search needle (no mapping needed). */
function normalize(text: string): string {
  return mapText(text).norm
}

/**
 * Returns the [start, end) character range in `clauseText` that the quote refers to, or
 * null if it truly cannot be found (should be rare, since the server already checked).
 */
export function findQuoteRange(clauseText: string, quote: string): QuoteRange | null {
  const needle = normalize(quote)
  if (needle.length < 3) return null

  const { norm, map } = mapText(clauseText)
  const haystack = ` ${norm} `
  const at = haystack.indexOf(` ${needle} `)
  if (at === -1) return null

  const normStart = at
  const normEnd = normStart + needle.length

  const start = map[normStart]
  const end = normEnd < map.length ? map[normEnd] : clauseText.length
  if (start === undefined) return null
  return { start, end }
}

/** Splits clause text into plain/highlighted segments, ready to render. */
export interface TextSegment {
  text: string
  highlighted: boolean
}

export function splitForHighlight(clauseText: string, quote: string): TextSegment[] {
  const range = quote.trim() ? findQuoteRange(clauseText, quote) : null
  if (!range) return [{ text: clauseText, highlighted: false }]

  const segments: TextSegment[] = []
  if (range.start > 0) segments.push({ text: clauseText.slice(0, range.start), highlighted: false })
  segments.push({ text: clauseText.slice(range.start, range.end), highlighted: true })
  if (range.end < clauseText.length) segments.push({ text: clauseText.slice(range.end), highlighted: false })
  return segments
}
