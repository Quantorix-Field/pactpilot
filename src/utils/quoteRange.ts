export interface QuoteRange {
  start: number
  end: number
}

interface Mapped {
  norm: string
  map: number[]
  endMap: number[]
}

const WORD = /[\p{L}\p{N}\p{M}]/u

function mapText(text: string): Mapped {
  let norm = ''
  const map: number[] = []
  const endMap: number[] = []
  let atSpace = true
  let i = 0
  for (const ch of text) {
    if (WORD.test(ch)) {
      norm += ch.toLowerCase()
      map.push(i)
      endMap.push(i + ch.length)
      atSpace = false
    } else if (!atSpace) {
      norm += ' '
      map.push(i)
      endMap.push(i + ch.length)
      atSpace = true
    }
    i += ch.length
  }
  if (atSpace && norm.length > 0) {
    norm = norm.slice(0, -1)
    map.pop()
    endMap.pop()
  }
  return { norm, map, endMap }
}

function normalize(text: string): string {
  return mapText(text).norm
}

export function findQuoteRange(clauseText: string, quote: string): QuoteRange | null {
  const needle = normalize(quote)
  if (needle.length < 3) return null

  const { norm, map, endMap } = mapText(clauseText)
  const haystack = ` ${norm} `
  const at = haystack.indexOf(` ${needle} `)
  if (at === -1) return null

  const normStart = at
  const normEnd = normStart + needle.length

  const start = map[normStart]
  const end = endMap[normEnd - 1]
  if (start === undefined || end === undefined) return null
  return { start, end }
}

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
