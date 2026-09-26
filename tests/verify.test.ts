import { describe, expect, it } from 'vitest'
import { buildIndex, checkRef, loose, verifyAnalysis, verifyAsk, verifyCompare, verifyWhatIf } from '../api/_lib/verify'
import type { Analysis, AskResult, ClauseIn, CompareResult, WhatIfResult } from '../api/_lib/schemas'

const clauses: ClauseIn[] = [
  { id: 'c1', label: '§1', text: 'The tenancy begins on 1 October and runs for 11 months.' },
  { id: 'c2', label: '§2', text: 'Rent is 18,000 per month, due on the 5th.' },
  {
    id: 'c4',
    label: '§4',
    text: "The landlord may end this agreement at any time with 7 days' notice, while the tenant must give 60 days.",
  },
]

describe('loose', () => {
  it('lowercases and strips punctuation to single spaces', () => {
    expect(loose("The Landlord's Notice, Period!")).toBe('the landlord s notice period')
  })
  it('collapses different unicode quote styles the same way', () => {
    expect(loose('60 days\u2019 notice')).toBe(loose("60 days' notice"))
  })
  it('preserves Hindi text, only normalizing punctuation and space', () => {
    expect(loose('7 दिन के नोटिस।')).toBe('7 दिन के नोटिस')
  })
})

describe('checkRef', () => {
  it('verifies a quote that really exists, exact case', () => {
    const idx = buildIndex(clauses)
    const r = checkRef(idx, 'c4', "7 days' notice")
    expect(r.verified).toBe(true)
    expect(r.clauseId).toBe('c4')
  })

  it('verifies despite different quote marks and case', () => {
    const idx = buildIndex(clauses)
    expect(checkRef(idx, 'c4', '7 DAYS\u2019 NOTICE').verified).toBe(true)
  })

  it('auto-corrects to the right clause when the AI names the wrong one', () => {
    const idx = buildIndex(clauses)
    const r = checkRef(idx, 'c2', "7 days' notice")
    expect(r.verified).toBe(true)
    expect(r.clauseId).toBe('c4')
  })

  it('a valid clause id with a non-matching quote keeps the clause id, blanks the quote', () => {
    const idx = buildIndex(clauses)
    const r = checkRef(idx, 'c2', 'the deposit is fully refundable within 3 days')
    expect(r.verified).toBe(false)
    expect(r.clauseId).toBe('c2')
    expect(r.quote).toBe('')
  })

  it('an unknown clause id with no verifiable quote clears the clause id entirely', () => {
    const idx = buildIndex(clauses)
    const r = checkRef(idx, 'zz', 'nonsense text not in the doc')
    expect(r.clauseId).toBe('')
    expect(r.verified).toBe(false)
  })

  it('rejects a quote shorter than the minimum', () => {
    const idx = buildIndex(clauses)
    expect(checkRef(idx, 'c2', 'is').verified).toBe(false)
  })

  it('does not match across word boundaries', () => {
    const idx = buildIndex([{ id: 'c1', label: '§1', text: 'The cat sat on the mat.' }])
    expect(checkRef(idx, 'c1', 'at sat on the ma').verified).toBe(false)
  })
})

const baseAnalysis: Analysis = {
  isLegalDocument: true,
  docType: 'Lease',
  parties: [],
  summary: 'x',
  keyFacts: [{ label: 'Rent', value: '18000', clauseId: 'c2' }],
  findings: [
    { clauseId: 'c4', severity: 'high', title: 'Notice mismatch', explanation: 'x', quote: "7 days' notice", suggestion: '', verified: false },
    { clauseId: 'c2', severity: 'high', title: 'Bad quote, real clause', explanation: 'x', quote: 'this text does not exist anywhere', suggestion: '', verified: false },
    { clauseId: 'zz', severity: 'high', title: 'Hallucinated clause', explanation: 'x', quote: 'also not in the document', suggestion: '', verified: false },
    { clauseId: '', severity: 'medium', title: 'Missing protection', explanation: 'no cap on fees', quote: '', suggestion: '', verified: false },
  ],
  contradictions: [
    { clauseIds: ['c1', 'c4'], issue: 'real conflict', severity: 'high' },
    { clauseIds: ['zz', 'yy'], issue: 'fake conflict, both ids invalid', severity: 'high' },
    { clauseIds: ['c1'], issue: 'only one real id, not a real contradiction', severity: 'medium' },
  ],
  obligations: [
    { title: 'Pay rent', dueLabel: 'monthly', kind: 'payment', clauseId: 'c2', date: '2026-02-30', recurrence: 'monthly' },
    { title: 'Vague', dueLabel: 'later', kind: 'other', clauseId: 'zz', date: '2026-10-05', recurrence: null },
  ],
  nextSteps: [{ action: 'ask', reason: '' }],
  lawyerQuestions: ['q1'],
}

describe('verifyAnalysis', () => {
  it('keeps a finding whose quote is fully verified', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    const kept = out.findings.find((f) => f.title === 'Notice mismatch')
    expect(kept?.verified).toBe(true)
    expect(kept?.clauseId).toBe('c4')
  })

  it('keeps a finding on a real clause even if its quote cannot be verified, but blanks the quote', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    const kept = out.findings.find((f) => f.title === 'Bad quote, real clause')
    expect(kept).toBeDefined()
    expect(kept?.verified).toBe(false)
    expect(kept?.clauseId).toBe('c2')
    expect(kept?.quote).toBe('')
  })

  it('drops a finding that points at a clause id which does not exist at all', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    expect(out.findings.some((f) => f.title === 'Hallucinated clause')).toBe(false)
  })

  it('keeps a "missing protection" finding that points at nothing', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    expect(out.findings.some((f) => f.title === 'Missing protection')).toBe(true)
  })

  it('keeps a real contradiction between two real clauses', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    expect(out.contradictions.some((c) => c.issue === 'real conflict')).toBe(true)
  })

  it('drops a contradiction with no real clause ids', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    expect(out.contradictions.some((c) => c.issue.includes('fake conflict'))).toBe(false)
  })

  it('drops a "contradiction" that only names one real clause', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    expect(out.contradictions.some((c) => c.issue.includes('only one real id'))).toBe(false)
  })

  it('clears clauseId on a keyFact pointing at a non-existent clause', () => {
    const out = verifyAnalysis({ ...baseAnalysis, keyFacts: [{ label: 'x', value: 'y', clauseId: 'nope' }] }, clauses)
    expect(out.keyFacts[0]?.clauseId).toBe('')
  })

  it('nulls an impossible obligation date (30 Feb) but keeps the obligation', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    const rent = out.obligations.find((o) => o.title === 'Pay rent')
    expect(rent?.date).toBe(null)
  })

  it('clears clauseId on an obligation pointing at a non-existent clause', () => {
    const out = verifyAnalysis(baseAnalysis, clauses)
    const vague = out.obligations.find((o) => o.title === 'Vague')
    expect(vague?.clauseId).toBe('')
  })

  it('clears every list when isLegalDocument is false, leaving other fields untouched', () => {
    const out = verifyAnalysis({ ...baseAnalysis, isLegalDocument: false }, clauses)
    expect(out.keyFacts).toEqual([])
    expect(out.findings).toEqual([])
    expect(out.contradictions).toEqual([])
    expect(out.obligations).toEqual([])
    expect(out.nextSteps).toEqual([])
    expect(out.lawyerQuestions).toEqual([])
    expect(out.docType).toBe(baseAnalysis.docType)
  })
})

describe('verifyWhatIf', () => {
  const base: Omit<WhatIfResult, 'steps'> = { covered: true, outcome: 'bad', answer: 'x', options: [], caveat: '' }

  it('keeps a fully verified step', () => {
    const result: WhatIfResult = {
      ...base,
      steps: [{ title: 'a', detail: 'x', clauseId: 'c4', quote: "7 days' notice", verified: false }],
    }
    const out = verifyWhatIf(result, clauses)
    expect(out.steps).toHaveLength(1)
    expect(out.steps[0]?.verified).toBe(true)
  })

  it('drops a step that points at a clause id which does not exist', () => {
    const result: WhatIfResult = {
      ...base,
      steps: [{ title: 'ghost', detail: 'x', clauseId: 'zz', quote: 'something totally made up', verified: false }],
    }
    expect(verifyWhatIf(result, clauses).steps).toHaveLength(0)
  })

  it('keeps a step on a real clause even with an unverifiable quote, but blanks the quote', () => {
    const result: WhatIfResult = {
      ...base,
      steps: [{ title: 'b', detail: 'x', clauseId: 'c2', quote: 'something totally made up', verified: false }],
    }
    const out = verifyWhatIf(result, clauses)
    expect(out.steps).toHaveLength(1)
    expect(out.steps[0]?.verified).toBe(false)
    expect(out.steps[0]?.quote).toBe('')
  })
})

describe('verifyAsk', () => {
  it('keeps only citations that are actually verified', () => {
    const result: AskResult = {
      answerable: true,
      answer: 'x',
      confidence: 'high',
      citations: [
        { clauseId: 'c4', quote: "7 days' notice", verified: false },
        { clauseId: 'c2', quote: 'invented text that is not present', verified: false },
      ],
    }
    const out = verifyAsk(result, clauses)
    expect(out.citations).toHaveLength(1)
    expect(out.citations[0]?.verified).toBe(true)
    expect(out.confidence).toBe('high')
  })

  it('downgrades confidence to low when no citation survives', () => {
    const result: AskResult = {
      answerable: true,
      answer: 'x',
      confidence: 'high',
      citations: [{ clauseId: 'c2', quote: 'invented text that is not present', verified: false }],
    }
    const out = verifyAsk(result, clauses)
    expect(out.citations).toHaveLength(0)
    expect(out.confidence).toBe('low')
  })

  it('clears citations entirely when the AI said it could not answer', () => {
    const result: AskResult = {
      answerable: false,
      answer: 'not in the document',
      confidence: 'low',
      citations: [{ clauseId: 'c2', quote: '18,000 per month', verified: false }],
    }
    expect(verifyAsk(result, clauses).citations).toEqual([])
  })
})

describe('verifyCompare', () => {
  const clausesA: ClauseIn[] = [{ id: 'a1', label: '§1', text: 'Notice period is 30 days.' }]
  const clausesB: ClauseIn[] = [{ id: 'b1', label: '§1', text: 'Notice period is 60 days.' }]

  it('keeps a difference with valid quotes on both sides', () => {
    const result: CompareResult = {
      overview: 'x',
      better: 'a',
      differences: [
        { topic: 'Notice', a: '30 days', b: '60 days', favors: 'a', why: 'x', aClause: 'a1', aQuote: '30 days', aVerified: false, bClause: 'b1', bQuote: '60 days', bVerified: false },
      ],
    }
    const out = verifyCompare(result, clausesA, clausesB)
    expect(out.differences).toHaveLength(1)
    expect(out.differences[0]?.aVerified).toBe(true)
    expect(out.differences[0]?.bVerified).toBe(true)
  })

  it('keeps a difference where one side is genuinely "not mentioned"', () => {
    const result: CompareResult = {
      overview: 'x',
      better: 'b',
      differences: [
        { topic: 'Pet policy', a: 'Not mentioned', b: 'Pets allowed with a fee', favors: 'b', why: 'x', aClause: '', aQuote: '', aVerified: false, bClause: 'b1', bQuote: '60 days', bVerified: false },
      ],
    }
    const out = verifyCompare(result, clausesA, clausesB)
    expect(out.differences).toHaveLength(1)
    expect(out.differences[0]?.bVerified).toBe(true)
  })

  it('drops a difference that cites clause ids which do not exist on either side', () => {
    const result: CompareResult = {
      overview: 'x',
      better: 'a',
      differences: [
        { topic: 'Fake', a: 'x', b: 'y', favors: 'a', why: 'x', aClause: 'zz', aQuote: 'this is not in document A', aVerified: false, bClause: 'yy', bQuote: 'this is not in document B', bVerified: false },
      ],
    }
    expect(verifyCompare(result, clausesA, clausesB).differences).toHaveLength(0)
  })

  it('keeps a difference on real clauses even if neither quote matches, but blanks both quotes', () => {
    const result: CompareResult = {
      overview: 'x',
      better: 'a',
      differences: [
        { topic: 'Real clauses, bad quotes', a: 'x', b: 'y', favors: 'a', why: 'x', aClause: 'a1', aQuote: 'this exact wording is not in document A', aVerified: false, bClause: 'b1', bQuote: 'this exact wording is not in document B', bVerified: false },
      ],
    }
    const out = verifyCompare(result, clausesA, clausesB)
    expect(out.differences).toHaveLength(1)
    expect(out.differences[0]?.aVerified).toBe(false)
    expect(out.differences[0]?.aQuote).toBe('')
  })

  it('keeps a genuinely unclaimed difference (both sides empty) as-is', () => {
    const result: CompareResult = {
      overview: 'x',
      better: 'balanced',
      differences: [
        { topic: 'Something abstract', a: 'similar', b: 'similar', favors: 'neither', why: 'x', aClause: '', aQuote: '', aVerified: false, bClause: '', bQuote: '', bVerified: false },
      ],
    }
    expect(verifyCompare(result, clausesA, clausesB).differences).toHaveLength(1)
  })
})
