import { describe, expect, it } from 'vitest'
import { buildChecklistText } from '../src/utils/exportChecklist'
import type { Analysis } from '../src/types'

const fullAnalysis: Analysis = {
  isLegalDocument: true,
  docType: 'Residential lease agreement',
  parties: ['Landlord: R. Mehta', 'Tenant: A. Rao'],
  summary:
    'This is an 11 month lease with a 60 day notice period for the tenant but only 7 days for the landlord.',
  keyFacts: [{ label: 'Rent', value: '18000/month', clauseId: 'c2' }],
  findings: [
    {
      clauseId: 'c4',
      severity: 'medium',
      title: 'Notice mismatch',
      explanation: 'Landlord gives less notice than tenant.',
      quote: '',
      suggestion: 'Ask for equal notice periods.',
      verified: true,
    },
    {
      clauseId: 'c9',
      severity: 'high',
      title: 'One-sided deposit clause',
      explanation: 'Landlord alone decides deductions from the deposit.',
      quote: '',
      suggestion: 'Request an itemised deduction list in writing.',
      verified: true,
    },
    {
      clauseId: 'c2',
      severity: 'ok',
      title: 'Clear rent terms',
      explanation: 'Rent amount and due date are stated plainly.',
      quote: '',
      suggestion: '',
      verified: true,
    },
    {
      clauseId: 'c5',
      severity: 'high',
      title: 'Automatic renewal',
      explanation: 'The lease renews automatically unless you cancel 90 days in advance.',
      quote: '',
      suggestion: '',
      verified: true,
    },
  ],
  obligations: [
    {
      title: 'Pay rent',
      dueLabel: '5th of every month',
      kind: 'payment',
      clauseId: 'c2',
      date: '2026-10-05',
      recurrence: 'monthly',
    },
  ],
  nextSteps: [
    { action: 'Ask the landlord to match notice periods', reason: 'currently unequal' },
    { action: 'Get the renewal clause in writing', reason: '' },
  ],
  lawyerQuestions: ['Is the 7-day landlord notice period enforceable under local tenancy law?'],
}

describe('buildChecklistText', () => {
  it('includes every section in the right order', () => {
    const text = buildChecklistText(fullAnalysis, 'My Lease', new Date('2026-09-24T00:00:00Z'))
    const order = [
      'SUMMARY',
      'KEY FACTS',
      'RISKS TO REVIEW',
      'OBLIGATIONS AND DATES',
      'BEFORE YOU SIGN',
      'QUESTIONS FOR A LAWYER',
    ]
    const positions = order.map((h) => text.indexOf(h))
    expect(positions.every((p) => p !== -1)).toBe(true)
    for (let i = 1; i < positions.length; i += 1) expect(positions[i]).toBeGreaterThan(positions[i - 1])
    expect(text).toContain('Document: My Lease')
    expect(text).toContain('Parties: Landlord: R. Mehta, Tenant: A. Rao')
    expect(text).toContain('Generated: 2026-09-24')
    expect(text.trim().endsWith('PactPilot provides information, not legal advice.')).toBe(true)
  })

  it('sorts findings by severity, high first, keeping order stable within a severity', () => {
    const text = buildChecklistText(fullAnalysis, 'My Lease')
    const deposit = text.indexOf('[HIGH RISK] One-sided deposit clause')
    const renewal = text.indexOf('[HIGH RISK] Automatic renewal')
    const notice = text.indexOf('[WATCH] Notice mismatch')
    const clear = text.indexOf('[FINE] Clear rent terms')
    expect(deposit).toBeLessThan(renewal)
    expect(renewal).toBeLessThan(notice)
    expect(notice).toBeLessThan(clear)
  })

  it('adds a suggestion line only when a suggestion exists', () => {
    const text = buildChecklistText(fullAnalysis, 'My Lease')
    expect(text).toContain('Request an itemised deduction list in writing.')
    const afterClear = text.slice(text.indexOf('[FINE] Clear rent terms'))
    const nextSection = afterClear.indexOf('OBLIGATIONS AND DATES')
    expect(afterClear.slice(0, nextSection)).not.toContain('\u2192')
  })

  it('falls back to (untitled) with no document name', () => {
    expect(buildChecklistText(fullAnalysis, '')).toContain('Document: (untitled)')
  })

  it('omits empty optional sections, with no stray headers', () => {
    const minimal: Analysis = {
      ...fullAnalysis,
      parties: [],
      keyFacts: [],
      findings: [],
      obligations: [],
      nextSteps: [],
      lawyerQuestions: [],
    }
    const text = buildChecklistText(minimal, 'Bare Doc')
    for (const h of ['KEY FACTS', 'RISKS TO REVIEW', 'OBLIGATIONS AND DATES', 'BEFORE YOU SIGN', 'QUESTIONS FOR A LAWYER']) {
      expect(text).not.toContain(h)
    }
    expect(text).not.toContain('Parties:')
    expect(text).toContain('SUMMARY')
  })

  it('word-wraps long text so every line stays within the width', () => {
    const longFinding: Analysis['findings'][number] = {
      clauseId: 'c1',
      severity: 'high',
      title: 'Very long risk title',
      explanation:
        'This explanation is intentionally long, repeating itself so that it definitely exceeds seventy two characters and needs to wrap onto more than one line for a real human reader.',
      quote: '',
      suggestion: '',
      verified: true,
    }
    const text = buildChecklistText({ ...fullAnalysis, findings: [longFinding] }, 'Doc')
    const block = text.split('RISKS TO REVIEW')[1]!.split('OBLIGATIONS')[0]!
    const lines = block.split('\n').filter((l) => l.trim() !== '' && !/^-+$/.test(l))
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(72)
  })

  it('keeps every Hindi word intact', () => {
    const hindiFinding: Analysis['findings'][number] = {
      clauseId: 'c1',
      severity: 'high',
      title: 'नोटिस अवधि में असमानता',
      explanation: 'मकान मालिक को केवल 7 दिन का नोटिस देना होता है जबकि किरायेदार को 60 दिन का नोटिस देना पड़ता है।',
      quote: '',
      suggestion: '',
      verified: true,
    }
    const text = buildChecklistText({ ...fullAnalysis, findings: [hindiFinding] }, 'दस्तावेज़')
    expect(text).toContain('Document: दस्तावेज़')
    for (const word of hindiFinding.explanation.split(' ')) expect(text).toContain(word)
  })
})
