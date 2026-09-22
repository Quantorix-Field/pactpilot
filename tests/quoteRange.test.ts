import { describe, expect, it } from 'vitest'
import { findQuoteRange, splitForHighlight } from '../src/utils/quoteRange'

describe('findQuoteRange', () => {
  it('finds an exact substring', () => {
    const text = "The landlord may end this agreement at any time with 7 days' notice."
    const r = findQuoteRange(text, 'end this agreement at any time')
    expect(r).not.toBe(null)
    expect(text.slice(r!.start, r!.end)).toBe('end this agreement at any time')
  })

  it('matches despite different quote marks and extra spacing', () => {
    const text = "The tenant must give 60 days' notice before leaving."
    const r = findQuoteRange(text, 'give   60 days\u2019 notice')
    expect(r).not.toBe(null)
    expect(text.slice(r!.start, r!.end)).toContain('60 days')
  })

  it('is case-insensitive', () => {
    const text = 'Rent is due on the 5th of every month.'
    const r = findQuoteRange(text, 'RENT IS DUE')
    expect(text.slice(r!.start, r!.end)).toBe('Rent is due')
  })

  it('ignores a fragment shorter than 3 characters', () => {
    expect(findQuoteRange('The rent is due.', 'is')).toBe(null)
  })

  it('returns null when the text is genuinely not there', () => {
    const text = 'The rent is due on the 5th.'
    expect(findQuoteRange(text, 'the deposit is refundable')).toBe(null)
  })

  it('respects word boundaries, so it does not match across word edges', () => {
    const text = 'The cat sat on the mat.'
    expect(findQuoteRange(text, 'at sat on the ma')).toBe(null)
  })

  it('works on Hindi text', () => {
    const text = 'मकान मालिक 7 दिन के नोटिस पर समझौता समाप्त कर सकता है।'
    const r = findQuoteRange(text, '7 दिन के नोटिस')
    expect(r).not.toBe(null)
    expect(text.slice(r!.start, r!.end)).toContain('नोटिस')
  })

  it('finds a quote at the very start and the very end of the clause', () => {
    const text = 'Deposit is refundable after deductions'
    const start = findQuoteRange(text, 'Deposit is refundable')
    expect(start?.start).toBe(0)
    const end = findQuoteRange(text, 'after deductions')
    expect(end?.end).toBe(text.length)
  })
})

describe('splitForHighlight', () => {
  it('splits text into plain, highlighted, plain segments', () => {
    const text = 'Rent is 18000 per month, due on the 5th.'
    const segments = splitForHighlight(text, '18000 per month')
    expect(segments.map((s) => s.text).join('')).toBe(text)
    expect(segments.filter((s) => s.highlighted)).toHaveLength(1)
  })

  it('falls back to one plain segment when the quote is empty', () => {
    const text = 'Some clause text.'
    expect(splitForHighlight(text, '')).toEqual([{ text, highlighted: false }])
  })

  it('falls back to one plain segment when the quote cannot be found', () => {
    const text = 'Some clause text.'
    expect(splitForHighlight(text, 'totally unrelated words here')).toEqual([
      { text, highlighted: false },
    ])
  })
})
