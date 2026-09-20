import type {
  Analysis,
  AskResult,
  Citation,
  ClauseIn,
  CompareResult,
  Finding,
  WhatIfResult,
} from './schemas.js'

type Contradiction = Analysis['contradictions'][number]
type WhatIfStep = WhatIfResult['steps'][number]
type Difference = CompareResult['differences'][number]

const MIN_QUOTE_WORDS = 2
const MIN_QUOTE_CHARS = 6

/**
 * Lowercase letters, numbers and marks only, with single spaces. Quote matching then ignores
 * quote style, dashes, line breaks and spacing, but never ignores a changed word or number.
 */
export function loose(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
}

interface IndexEntry {
  id: string
  /** Padded with spaces so a match must start and end on a word boundary. */
  norm: string
}

export interface ClauseIndex {
  ids: ReadonlySet<string>
  entries: readonly IndexEntry[]
}

export function buildIndex(clauses: readonly ClauseIn[]): ClauseIndex {
  const entries = clauses.map((c) => ({ id: c.id, norm: ` ${loose(c.text)} ` }))
  return { ids: new Set(entries.map((e) => e.id)), entries }
}

export interface RefResult {
  clauseId: string
  quote: string
  verified: boolean
}

function isSubstantial(q: string): boolean {
  return q.length >= MIN_QUOTE_CHARS && q.split(' ').length >= MIN_QUOTE_WORDS
}

/**
 * Checks one clause reference. A quote is verified only if it really appears in the
 * document. If the AI named the wrong clause but the quote exists elsewhere, the reference
 * is corrected to the clause that really contains it.
 */
export function checkRef(index: ClauseIndex, clauseId: string, quote: string): RefResult {
  const id = index.ids.has(clauseId) ? clauseId : ''
  const q = loose(quote)
  if (isSubstantial(q)) {
    const needle = ` ${q} `
    const claimed = index.entries.find((e) => e.id === id)
    const hit =
      claimed && claimed.norm.includes(needle)
        ? claimed
        : index.entries.find((e) => e.norm.includes(needle))
    if (hit) return { clauseId: hit.id, quote: quote.trim(), verified: true }
  }
  return { clauseId: id, quote: '', verified: false }
}

/**
 * Returns null when the AI pointed at something (a clause id or a quote) that cannot be
 * found anywhere. Such items are invented and get dropped. Items that point at nothing at
 * all (for example a missing protection) are legitimate and kept.
 */
function resolve(index: ClauseIndex, clauseId: string, quote: string): RefResult | null {
  const ref = checkRef(index, clauseId, quote)
  const claimed = clauseId !== '' || quote !== ''
  return claimed && ref.clauseId === '' ? null : ref
}

function cleanDate(value: string | null): string | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (y < 1990 || y > 2100) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  return real ? value : null
}

export function verifyAnalysis(analysis: Analysis, clauses: readonly ClauseIn[]): Analysis {
  if (!analysis.isLegalDocument) {
    return {
      ...analysis,
      keyFacts: [],
      findings: [],
      contradictions: [],
      obligations: [],
      nextSteps: [],
      lawyerQuestions: [],
    }
  }

  const index = buildIndex(clauses)
  const idOrEmpty = (id: string): string => (index.ids.has(id) ? id : '')

  const findings = analysis.findings.flatMap((f): Finding[] => {
    const ref = resolve(index, f.clauseId, f.quote)
    return ref ? [{ ...f, clauseId: ref.clauseId, quote: ref.quote, verified: ref.verified }] : []
  })

  const contradictions = analysis.contradictions.flatMap((c): Contradiction[] => {
    const ids = [...new Set(c.clauseIds.filter((id) => index.ids.has(id)))]
    return ids.length >= 2 ? [{ ...c, clauseIds: ids }] : []
  })

  return {
    ...analysis,
    findings,
    contradictions,
    keyFacts: analysis.keyFacts.map((k) => ({ ...k, clauseId: idOrEmpty(k.clauseId) })),
    obligations: analysis.obligations.map((o) => ({
      ...o,
      clauseId: idOrEmpty(o.clauseId),
      date: cleanDate(o.date),
    })),
  }
}

export function verifyWhatIf(result: WhatIfResult, clauses: readonly ClauseIn[]): WhatIfResult {
  const index = buildIndex(clauses)
  const steps = result.steps.flatMap((s): WhatIfStep[] => {
    const ref = resolve(index, s.clauseId, s.quote)
    return ref ? [{ ...s, clauseId: ref.clauseId, quote: ref.quote, verified: ref.verified }] : []
  })
  return { ...result, steps }
}

/** Only citations whose quote is really in the document survive. */
export function verifyAsk(result: AskResult, clauses: readonly ClauseIn[]): AskResult {
  const index = buildIndex(clauses)
  const citations = result.answerable
    ? result.citations.flatMap((c): Citation[] => {
        const ref = checkRef(index, c.clauseId, c.quote)
        return ref.verified
          ? [{ clauseId: ref.clauseId, quote: ref.quote, verified: true }]
          : []
      })
    : []
  return {
    ...result,
    citations,
    confidence: result.answerable && citations.length === 0 ? 'low' : result.confidence,
  }
}

export function verifyCompare(
  result: CompareResult,
  clausesA: readonly ClauseIn[],
  clausesB: readonly ClauseIn[],
): CompareResult {
  const indexA = buildIndex(clausesA)
  const indexB = buildIndex(clausesB)

  const differences = result.differences.flatMap((d): Difference[] => {
    const refA = checkRef(indexA, d.aClause, d.aQuote)
    const refB = checkRef(indexB, d.bClause, d.bQuote)
    const claimedA = d.aClause !== '' || d.aQuote !== ''
    const claimedB = d.bClause !== '' || d.bQuote !== ''
    const anyClaim = claimedA || claimedB
    const anyGood = (claimedA && refA.clauseId !== '') || (claimedB && refB.clauseId !== '')
    if (anyClaim && !anyGood) return []
    return [
      {
        ...d,
        aClause: refA.clauseId,
        aQuote: refA.quote,
        aVerified: refA.verified,
        bClause: refB.clauseId,
        bQuote: refB.quote,
        bVerified: refB.verified,
      },
    ]
  })

  return { ...result, differences }
}
