import { describe, expect, it } from 'vitest'
import { LIMITS } from '../api/_lib/limits'
import { splitIntoClauses } from '../src/utils/clauseSplitter'

const labelsOf = (text: string): string[] => splitIntoClauses(text).clauses.map((c) => c.label)

describe('splitIntoClauses: headings', () => {
  it('splits numbered clauses and uses the number as the label', () => {
    const result = splitIntoClauses(
      '1. Term\nThe lease runs 11 months.\n\n2. Rent\nRent is 18000 per month.',
    )
    expect(result.clauses.map((c) => c.label)).toEqual(['§1', '§2'])
    expect(result.clauses[0].text).toContain('The lease runs 11 months.')
    expect(result.clauses[1].text).toContain('Rent is 18000 per month.')
  })

  it('understands dotted sub-numbers such as 4.2', () => {
    expect(labelsOf('4.1 Rent\nPay on the 5th.\n4.2 Notice\nGive 60 days notice.')).toEqual([
      '§4.1',
      '§4.2',
    ])
  })

  it('understands Section, Article and the § sign', () => {
    expect(labelsOf('Section 5. Deposit\nRefundable.\nArticle II - Term\nEleven months.')).toEqual([
      '§5',
      '§II',
    ])
    expect(labelsOf('§7 Deposit\nHeld by the landlord.')).toEqual(['§7'])
  })

  it('treats ALL CAPS lines as headings and numbers them as paragraphs', () => {
    const result = splitIntoClauses(
      'TERMINATION\nEither party may terminate.\n\nPAYMENT\nRent is due monthly.',
    )
    expect(result.clauses.map((c) => c.label)).toEqual(['¶1', '¶2'])
    expect(result.clauses[0].text).toContain('TERMINATION')
  })

  it('splits text without headings into paragraphs', () => {
    expect(labelsOf('First paragraph here.\n\nSecond paragraph here.')).toEqual(['¶1', '¶2'])
  })

  it('does not mistake ordinary sentences for headings', () => {
    const result = splitIntoClauses(
      '1. Deposit\n1.5 times the monthly rent is held as deposit.\nSection 5 of the Act applies here.',
    )
    expect(result.clauses).toHaveLength(1)
    expect(result.clauses[0].text).toContain('1.5 times the monthly rent')
    expect(result.clauses[0].text).toContain('Section 5 of the Act')
  })

  it('keeps blank lines inside a numbered clause', () => {
    const result = splitIntoClauses('1. Term\nLine one.\n\nLine two.\n\n2. Rent\nPay.')
    expect(result.clauses).toHaveLength(2)
    expect(result.clauses[0].text).toContain('Line one.')
    expect(result.clauses[0].text).toContain('Line two.')
  })

  it('keeps a title above numbered clauses as its own paragraph', () => {
    expect(labelsOf('RENTAL AGREEMENT\n\n1. Term\nEleven months.')).toEqual(['¶1', '§1'])
  })

  it('handles Hindi text', () => {
    const result = splitIntoClauses(
      '1. किराया\nकिराया हर महीने की 5 तारीख को देय है।\n\n2. समाप्ति\nमकान मालिक 7 दिन के नोटिस पर समझौता समाप्त कर सकता है।',
    )
    expect(result.clauses.map((c) => c.label)).toEqual(['§1', '§2'])
    expect(result.clauses[1].text).toContain('7 दिन के नोटिस')
  })
})

describe('splitIntoClauses: cleaning', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    const result = splitIntoClauses('   \n\n  \t ')
    expect(result.clauses).toEqual([])
    expect(result.chars).toBe(0)
    expect(result.tooLong).toBe(false)
  })

  it('removes invisible characters and collapses extra spaces', () => {
    const result = splitIntoClauses('Rent\u200B  is\u00A0due\u0000 monthly.')
    expect(result.clauses[0].text).toBe('Rent is due monthly.')
  })

  it('accepts Windows line endings', () => {
    expect(labelsOf('1. Term\r\nText.\r\n\r\n2. Rent\r\nMore.')).toEqual(['§1', '§2'])
  })

  it('never changes the wording of a clause', () => {
    const sentence = "The landlord may end this agreement at any time with 7 days' notice."
    const result = splitIntoClauses(`4. Termination\n${sentence}`)
    expect(result.clauses[0].text).toContain(sentence)
  })

  it('gives every clause a unique, sequential id', () => {
    const ids = splitIntoClauses('1. A\nx\n2. B\ny\n3. C\nz').clauses.map((c) => c.id)
    expect(ids).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('splitIntoClauses: limits', () => {
  it('cuts a very long clause into parts that fit the server limit', () => {
    const body = Array.from({ length: 260 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')
    const original = `1. Long clause\n${body}`
    const { clauses } = splitIntoClauses(original)

    expect(clauses.length).toBeGreaterThan(1)
    expect(clauses[0].label).toBe('§1 ·1')
    for (const c of clauses) expect(c.text.length).toBeLessThanOrEqual(LIMITS.maxClauseChars)

    const rejoined = clauses.map((c) => c.text).join(' ').replace(/\s+/g, ' ')
    expect(rejoined).toBe(original.replace(/\s+/g, ' ').trim())
  })

  it('merges neighbouring clauses when a document has too many', () => {
    const many = Array.from(
      { length: 200 },
      (_, i) => `${i + 1}. Item ${i + 1}\nSome text for clause ${i + 1}.`,
    ).join('\n')
    const { clauses } = splitIntoClauses(many)

    expect(clauses.length).toBeLessThanOrEqual(LIMITS.maxClauses)
    expect(clauses[0].label).toContain('–')
    const all = clauses.map((c) => c.text).join('\n')
    expect(all).toContain('Item 1\n')
    expect(all).toContain('Item 200')
  })

  it('reports documents that are longer than the analysis limit', () => {
    const paragraph = 'This paragraph is filler text for a long document. '.repeat(18)
    const long = Array.from({ length: 60 }, () => paragraph).join('\n\n')
    expect(splitIntoClauses(long).tooLong).toBe(true)
    expect(splitIntoClauses('A short contract.').tooLong).toBe(false)
  })
})
