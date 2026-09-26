import { describe, expect, it } from 'vitest'
import {
  AnalysisSchema,
  AnalyzeRequestSchema,
  AskRequestSchema,
  AskSchema,
  CitationSchema,
  ClauseInSchema,
  ClausesSchema,
  CompareRequestSchema,
  CompareSchema,
  ExtractRequestSchema,
  FindingSchema,
  WhatIfRequestSchema,
  WhatIfSchema,
} from '../api/_lib/schemas'

const oneClause = [{ id: 'c1', label: '§1', text: 'Rent is due monthly.' }]

describe('ClauseInSchema and ClausesSchema', () => {
  it('accepts a well-formed clause', () => {
    expect(ClauseInSchema.safeParse({ id: 'c1', label: '§1', text: 'Some clause text.' }).success).toBe(true)
  })

  it('rejects an id that does not match the c<number> pattern', () => {
    expect(ClauseInSchema.safeParse({ id: 'clause-1', label: '§1', text: 'x' }).success).toBe(false)
  })

  it('strips control characters and trims whitespace from text', () => {
    const r = ClauseInSchema.safeParse({ id: 'c1', label: '§1', text: '  Rent\u0000 is due.  ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.text).toBe('Rent is due.')
  })

  it('rejects empty text after trimming', () => {
    expect(ClauseInSchema.safeParse({ id: 'c1', label: '§1', text: '   ' }).success).toBe(false)
  })

  it('rejects an empty clause array', () => {
    expect(ClausesSchema.safeParse([]).success).toBe(false)
  })

  it('rejects duplicate clause ids', () => {
    const dup = [
      { id: 'c1', label: '§1', text: 'a' },
      { id: 'c1', label: '§2', text: 'b' },
    ]
    expect(ClausesSchema.safeParse(dup).success).toBe(false)
  })

  it('rejects more than 120 clauses, accepts exactly 120', () => {
    const tooMany = Array.from({ length: 121 }, (_, i) => ({ id: `c${i + 1}`, label: 'x', text: 'x' }))
    const justRight = Array.from({ length: 120 }, (_, i) => ({ id: `c${i + 1}`, label: 'x', text: 'x' }))
    expect(ClausesSchema.safeParse(tooMany).success).toBe(false)
    expect(ClausesSchema.safeParse(justRight).success).toBe(true)
  })

  it('rejects a document whose total text exceeds the character limit', () => {
    const big = [{ id: 'c1', label: 'x', text: 'a'.repeat(40_001) }]
    expect(ClausesSchema.safeParse(big).success).toBe(false)
  })
})

describe('AnalyzeRequestSchema', () => {
  it('fills in language "en" and simple false when omitted', () => {
    const r = AnalyzeRequestSchema.safeParse({ clauses: oneClause })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.language).toBe('en')
      expect(r.data.simple).toBe(false)
      expect(r.data.perspective).toBeUndefined()
    }
  })

  it('accepts an explicit "hi" language and a perspective', () => {
    const r = AnalyzeRequestSchema.safeParse({ clauses: oneClause, language: 'hi', perspective: 'tenant', simple: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.perspective).toBe('tenant')
  })

  it('rejects an unsupported language code', () => {
    expect(AnalyzeRequestSchema.safeParse({ clauses: oneClause, language: 'fr' }).success).toBe(false)
  })
})

describe('minimum input lengths', () => {
  it('WhatIfRequestSchema rejects a scenario shorter than 4 characters, accepts exactly 4', () => {
    expect(WhatIfRequestSchema.safeParse({ clauses: oneClause, scenario: 'hi', language: 'en' }).success).toBe(false)
    expect(WhatIfRequestSchema.safeParse({ clauses: oneClause, scenario: 'test', language: 'en' }).success).toBe(true)
  })

  it('AskRequestSchema rejects a question shorter than 3 characters, accepts exactly 3', () => {
    expect(AskRequestSchema.safeParse({ clauses: oneClause, question: 'hi', language: 'en' }).success).toBe(false)
    expect(AskRequestSchema.safeParse({ clauses: oneClause, question: 'why', language: 'en' }).success).toBe(true)
  })
})

describe('CompareRequestSchema', () => {
  it('accepts two documents, with an optional name', () => {
    const r = CompareRequestSchema.safeParse({
      a: { clauses: oneClause },
      b: { name: 'Lease v2', clauses: oneClause },
      language: 'en',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.b.name).toBe('Lease v2')
  })
})

describe('ExtractRequestSchema', () => {
  it('accepts a plausible base64 payload with the right mime type', () => {
    expect(ExtractRequestSchema.safeParse({ mimeType: 'application/pdf', data: 'A'.repeat(200) }).success).toBe(true)
  })
  it('rejects a non-PDF mime type', () => {
    expect(ExtractRequestSchema.safeParse({ mimeType: 'image/png', data: 'A'.repeat(200) }).success).toBe(false)
  })
  it('rejects data that is not valid base64 characters', () => {
    expect(ExtractRequestSchema.safeParse({ mimeType: 'application/pdf', data: 'not base64!! '.repeat(20) }).success).toBe(false)
  })
  it('rejects a suspiciously short payload', () => {
    expect(ExtractRequestSchema.safeParse({ mimeType: 'application/pdf', data: 'QQ==' }).success).toBe(false)
  })
})

describe('the "unverified" guard', () => {
  it('forces verified back to false even when the input claims true', () => {
    const r = CitationSchema.safeParse({ clauseId: 'c1', quote: 'x', verified: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.verified).toBe(false)
  })

  it('produces verified: false even when the field is missing entirely', () => {
    const r = FindingSchema.safeParse({ clauseId: 'c1', severity: 'high', title: 't', explanation: 'e' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.verified).toBe(false)
  })
})

describe('enum fallbacks via .catch()', () => {
  it('an invalid severity falls back to "medium" instead of failing', () => {
    const r = FindingSchema.safeParse({ clauseId: 'c1', severity: 'catastrophic', title: 't', explanation: 'e' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.severity).toBe('medium')
  })
})

describe('clauseId and isoDate transforms', () => {
  it('a missing or null clauseId becomes an empty string, not null or undefined', () => {
    const r1 = CitationSchema.safeParse({ quote: 'x' })
    const r2 = CitationSchema.safeParse({ clauseId: null, quote: 'x' })
    expect(r1.success && r1.data.clauseId).toBe('')
    expect(r2.success && r2.data.clauseId).toBe('')
  })

  it('trims and lowercases a clauseId', () => {
    const r = CitationSchema.safeParse({ clauseId: '  C7  ', quote: 'x' })
    expect(r.success && r.data.clauseId).toBe('c7')
  })
})

describe('AnalysisSchema', () => {
  it('defaults isLegalDocument to true and every list to [] when omitted', () => {
    const r = AnalysisSchema.safeParse({ docType: 'Lease', summary: 'x' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.isLegalDocument).toBe(true)
      expect(r.data.findings).toEqual([])
      expect(r.data.nextSteps).toEqual([])
      expect(r.data.parties).toEqual([])
    }
  })

  it('caps findings at 14 even if the model sends more', () => {
    const findings = Array.from({ length: 20 }, (_, i) => ({ clauseId: `c${i}`, severity: 'high', title: `f${i}`, explanation: 'e' }))
    const r = AnalysisSchema.safeParse({ docType: 'Lease', summary: 'x', findings })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.findings).toHaveLength(14)
  })

  it('rejects when a truly required field (summary) is missing', () => {
    expect(AnalysisSchema.safeParse({ docType: 'Lease' }).success).toBe(false)
  })

  it('falls back to a null recurrence instead of failing on an invalid value', () => {
    const r = AnalysisSchema.safeParse({
      docType: 'Lease',
      summary: 'x',
      obligations: [{ title: 'Pay rent', dueLabel: 'monthly', clauseId: 'c1', recurrence: 'daily' }],
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.obligations[0]?.recurrence).toBe(null)
  })

  it('keeps a well-formed date and nulls a malformed one', () => {
    const r = AnalysisSchema.safeParse({
      docType: 'Lease',
      summary: 'x',
      obligations: [
        { title: 'A', dueLabel: 'x', clauseId: 'c1', date: '2026-10-05' },
        { title: 'B', dueLabel: 'x', clauseId: 'c1', date: '5th October' },
      ],
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.obligations[0]?.date).toBe('2026-10-05')
      expect(r.data.obligations[1]?.date).toBe(null)
    }
  })

  it('tolerates the model omitting findings and nextSteps entirely', () => {
    const r = AnalysisSchema.safeParse({ docType: 'Lease', summary: 'x' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.findings).toEqual([])
      expect(r.data.nextSteps).toEqual([])
    }
  })
})

describe('WhatIfSchema, AskSchema, CompareSchema', () => {
  it('WhatIfSchema falls back an invalid outcome to "unclear" and tolerates missing steps', () => {
    const r = WhatIfSchema.safeParse({ answer: 'x', outcome: 'terrible' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.outcome).toBe('unclear')
      expect(r.data.steps).toEqual([])
    }
  })

  it('AskSchema falls back an invalid confidence to "low"', () => {
    const r = AskSchema.safeParse({ answerable: true, answer: 'x', confidence: 'super-sure' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.confidence).toBe('low')
  })

  it('AskSchema requires "answerable" with no default', () => {
    expect(AskSchema.safeParse({ answer: 'x' }).success).toBe(false)
  })

  it('CompareSchema falls back an invalid "better" to "unclear" and tolerates missing differences', () => {
    const r = CompareSchema.safeParse({ overview: 'x' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.better).toBe('unclear')
      expect(r.data.differences).toEqual([])
    }
  })

  it('CompareSchema caps differences at 12', () => {
    const differences = Array.from({ length: 15 }, (_, i) => ({ topic: `t${i}`, a: 'x', b: 'y', why: 'z' }))
    const r = CompareSchema.safeParse({ overview: 'x', differences })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.differences).toHaveLength(12)
  })
})
