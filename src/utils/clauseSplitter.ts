import { LIMITS } from '../../api/_lib/limits'
import type { Clause } from '../types'

/**
 * Turns pasted or extracted contract text into numbered clauses. This runs in the browser,
 * before the AI sees anything, so the AI can only point at clauses that really exist.
 * Wording is never changed: only whitespace and invisible characters are cleaned.
 */

export interface SplitResult {
  clauses: Clause[]
  /** Total characters across all clauses. */
  chars: number
  /** True when the document is longer than the analysis limit. Nothing is cut silently. */
  tooLong: boolean
}

interface Block {
  label: string
  text: string
}

interface Draft {
  label: string
  sticky: boolean
  lines: string[]
}

const MAX_LABEL = 24
const CHUNK_TARGET = 2_800
const MIN_CUT = 1_000

/** "Section 4.", "Clause 7:", "Article II -". A sentence like "Section 5 of the Act" does not match. */
const NAMED =
  /^(?:Section|SECTION|section|Sec\.|Clause|CLAUSE|clause|Article|ARTICLE|article|Art\.)\s+(\d{1,3}(?:\.\d{1,3}){0,3}|[IVXLCDM]{1,6})\s*(?:[.:)–—-]|$)/
const SIGN = /^§\s*(\d{1,3}(?:\.\d{1,3}){0,3})/
/** "4. Notice", "4.2. Notice", "4) Notice". */
const NUMBERED = /^(\d{1,3}(?:\.\d{1,3}){0,3})[.)]\s+\S/
/** "4.2 Notice": the next word must start with a capital, so "1.5 times the rent" is not a heading. */
const DOTTED = /^(\d{1,3}(?:\.\d{1,3}){1,3})\s+[\p{Lu}\u0900-\u097F]/u

function mapChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0
  if (code === 10 || (code >= 11 && code <= 13) || code === 0x2028 || code === 0x2029) return '\n'
  if (code === 9 || code === 0xa0) return ' '
  const invisible =
    code < 32 || code === 127 || (code >= 0x200b && code <= 0x200d) || code === 0xfeff
  return invisible ? '' : ch
}

function clean(raw: string): string {
  let out = ''
  for (const ch of raw.replace(/\r\n/g, '\n').normalize('NFC')) out += mapChar(ch)
  return out
}

/** A short line in capitals with no lowercase letters, such as "TERMINATION". */
function isCapsHeading(line: string): boolean {
  if (line.length < 3 || line.length > 60 || /[.;,]$/.test(line)) return false
  if (/\p{Ll}/u.test(line)) return false
  return (line.match(/\p{Lu}/gu) ?? []).length >= 3
}

/** Numbered headings carry their number as the label. Unnumbered ones return label null. */
function headingOf(line: string): { label: string | null } | null {
  const m = NAMED.exec(line) ?? SIGN.exec(line) ?? NUMBERED.exec(line) ?? DOTTED.exec(line)
  if (m) return { label: `§${m[1]}` }
  return isCapsHeading(line) ? { label: null } : null
}

/**
 * Groups lines into blocks. A heading starts a block that continues across blank lines until
 * the next heading. Text without a heading is split into paragraphs at blank lines.
 */
function collect(lines: readonly string[]): Block[] {
  const drafts: Draft[] = []
  let para = 0
  let gap = false

  const open = (label: string | null, line: string, sticky: boolean): void => {
    if (label === null) para += 1
    drafts.push({ label: label ?? `¶${para}`, sticky, lines: [line] })
    gap = false
  }

  for (const line of lines) {
    if (line === '') {
      gap = true
      continue
    }
    const heading = headingOf(line)
    if (heading) {
      open(heading.label, line, true)
      continue
    }
    const current = drafts.at(-1)
    if (!current || (gap && !current.sticky)) {
      open(null, line, false)
      continue
    }
    if (gap) current.lines.push('')
    current.lines.push(line)
    gap = false
  }

  return drafts
    .map((d) => ({ label: d.label, text: d.lines.join('\n').trim() }))
    .filter((b) => b.text !== '')
}

/** Finds a natural place to cut: a paragraph break, then a line, then a sentence, then a space. */
function cutPoint(text: string): number {
  const window = text.slice(0, CHUNK_TARGET)
  for (const sep of ['\n\n', '\n', '. ', ' ']) {
    const at = window.lastIndexOf(sep)
    if (at >= MIN_CUT) return at + 1
  }
  return CHUNK_TARGET
}

/** A very long clause is cut into parts so each one fits the server limit. */
function chunk(block: Block): Block[] {
  if (block.text.length <= LIMITS.maxClauseChars) return [block]
  const parts: string[] = []
  let rest = block.text
  while (rest.length > LIMITS.maxClauseChars) {
    const cut = cutPoint(rest)
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts.map((text, i) => ({ label: `${block.label} ·${i + 1}`, text }))
}

/** Documents with more than the allowed number of clauses get neighbouring clauses merged. */
function pack(blocks: readonly Block[]): Block[] {
  const total = blocks.reduce((n, b) => n + b.text.length, 0)
  const capacity = Math.min(2_500, Math.max(500, Math.ceil(total / 50)))
  const groups: Array<{ first: string; last: string; text: string }> = []
  for (const b of blocks) {
    const g = groups.at(-1)
    if (g && g.text.length + 2 + b.text.length <= capacity) {
      g.text += `\n\n${b.text}`
      g.last = b.label
    } else {
      groups.push({ first: b.label, last: b.label, text: b.text })
    }
  }
  return groups.map((g) => ({
    label: g.first === g.last ? g.first : `${g.first}–${g.last}`,
    text: g.text,
  }))
}

const fit = (label: string): string =>
  label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1)}…`

export function splitIntoClauses(raw: string): SplitResult {
  const lines = clean(raw)
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
  const sized = collect(lines).flatMap(chunk)
  const packed = sized.length > LIMITS.maxClauses ? pack(sized) : sized
  const clauses: Clause[] = packed.map((b, i) => ({
    id: `c${i + 1}`,
    label: fit(b.label),
    text: b.text,
  }))
  const chars = clauses.reduce((sum, c) => sum + c.text.length, 0)
  return { clauses, chars, tooLong: chars > LIMITS.maxDocChars }
}
