import { describe, expect, it } from 'vitest'
import { buildIcs, obligationsWithDates } from '../src/utils/ics'
import type { Obligation } from '../src/types'

const base: Omit<Obligation, 'date' | 'recurrence'> = {
  title: 'Pay rent',
  dueLabel: '5th of every month',
  kind: 'payment',
  clauseId: 'c2',
}

const unfold = (ics: string): string => ics.replace(/\r\n /g, '')

describe('buildIcs', () => {
  it('wraps everything in a valid VCALENDAR', () => {
    const lines = buildIcs([], 'Lease').split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines.at(-1)).toBe('END:VCALENDAR')
  })

  it('uses CRLF line endings throughout, never a bare LF', () => {
    const ics = buildIcs([{ ...base, date: '2026-10-05', recurrence: 'monthly' }], 'Lease')
    expect(ics).toContain('\r\n')
    expect(ics).not.toMatch(/[^\r]\n/)
  })

  it('leaves out obligations with no date', () => {
    const ics = buildIcs([{ ...base, date: null, recurrence: null }], 'Lease')
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('excludes an impossible calendar date such as 30 February', () => {
    const dated = obligationsWithDates([
      { ...base, title: 'Bad date', date: '2026-02-30', recurrence: null },
      { ...base, title: 'Good date', date: '2026-02-15', recurrence: null },
    ])
    expect(dated).toHaveLength(1)
    expect(dated[0].title).toBe('Good date')
  })

  it('sets DTEND one day after DTSTART', () => {
    const ics = buildIcs([{ ...base, date: '2026-10-05', recurrence: null }], 'Lease')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261005')
    expect(ics).toContain('DTEND;VALUE=DATE:20261006')
  })

  it('rolls DTEND over a month boundary', () => {
    const ics = buildIcs([{ ...base, date: '2026-01-31', recurrence: null }], 'Lease')
    expect(ics).toContain('DTEND;VALUE=DATE:20260201')
  })

  it('rolls DTEND over a year boundary', () => {
    const ics = buildIcs([{ ...base, date: '2026-12-31', recurrence: null }], 'Lease')
    expect(ics).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('adds RRULE only when a recurrence is set', () => {
    const withRec = buildIcs([{ ...base, date: '2026-10-05', recurrence: 'monthly' }], 'Lease')
    expect(withRec).toContain('RRULE:FREQ=MONTHLY')

    const noRec = buildIcs([{ ...base, date: '2026-10-05', recurrence: 'once' }], 'Lease')
    expect(noRec).not.toContain('RRULE')
  })

  it('escapes commas, semicolons and backslashes', () => {
    const ics = buildIcs(
      [{ ...base, title: 'Pay rent, in full; no excuses \\ ever', date: '2026-10-05', recurrence: null }],
      'Lease',
    )
    expect(unfold(ics)).toContain('SUMMARY:Pay rent\\, in full\\; no excuses \\\\ ever')
  })

  it('joins a multi-line description with the literal backslash-n sequence, not a real newline', () => {
    const ics = buildIcs([{ ...base, date: '2026-10-05', recurrence: null }], 'My Lease')
    const descLine = unfold(ics)
      .split('\r\n')
      .find((l) => l.startsWith('DESCRIPTION:'))
    expect(descLine).toContain('5th of every month\\nDocument: My Lease\\nClause: c2')
    expect(descLine).not.toContain('\n')
  })

  it('folds long lines and unfolds back to the exact original text', () => {
    const longTitle = 'A very long obligation title that goes on and on '.repeat(3).trim()
    const ics = buildIcs([{ ...base, title: longTitle, date: '2026-10-05', recurrence: null }], 'Lease')
    expect(ics).toContain('\r\n ')
    expect(unfold(ics)).toContain(`SUMMARY:${longTitle}`)
  })

  it('keeps Hindi text intact when folding', () => {
    const title = 'किराया भुगतान अनुस्मारक: हर महीने की 5 तारीख को समय पर किराया चुकाएं'
    const ics = buildIcs([{ ...base, title, date: '2026-10-05', recurrence: null }], 'Lease')
    expect(unfold(ics)).toContain(`SUMMARY:${title}`)
  })

  it('gives each obligation its own event with a unique UID', () => {
    const ics = buildIcs(
      [
        { ...base, date: '2026-10-05', recurrence: 'monthly' },
        { ...base, title: 'Give notice', date: '2026-11-01', recurrence: null },
      ],
      'Lease',
    )
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    const uids = [...ics.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1])
    expect(new Set(uids).size).toBe(2)
  })
})
