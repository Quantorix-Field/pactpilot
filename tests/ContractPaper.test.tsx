import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContractPaper } from '../src/components/ContractPaper'
import type { Doc, Finding } from '../src/types'

const doc: Doc = {
  name: 'My Lease',
  clauses: [
    { id: 'c1', label: '§1', text: 'The tenancy begins on 1 October and runs for 11 months.' },
    { id: 'c4', label: '§4', text: "The landlord may end this agreement with 7 days' notice." },
  ],
}

const highFinding: Finding = {
  clauseId: 'c4',
  severity: 'high',
  title: 'Notice mismatch',
  explanation: 'The landlord can end this with very little notice.',
  quote: "7 days' notice",
  suggestion: 'Ask for a longer notice period.',
  verified: true,
}

function noop(): void {
  /* unused in most tests */
}

describe('ContractPaper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the document name and every clause label', () => {
    render(
      <ContractPaper doc={doc} findings={[]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    expect(screen.getByText('My Lease')).toBeInTheDocument()
    expect(screen.getByText('§1')).toBeInTheDocument()
    expect(screen.getByText('§4')).toBeInTheDocument()
  })

  it('labels the section with the document name', () => {
    render(
      <ContractPaper doc={doc} findings={[]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    expect(screen.getByRole('region', { name: /my lease, analyzed/i })).toBeInTheDocument()
  })

  it('highlights the exact verified quote inside its clause', () => {
    render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    const mark = screen.getByText("7 days' notice")
    expect(mark.tagName).toBe('MARK')
    expect(mark).toHaveClass('mark--high')
  })

  it('ignores an unverified finding: no highlight, not clickable', () => {
    render(
      <ContractPaper
        doc={doc}
        findings={[{ ...highFinding, verified: false }]}
        status="ready"
        activeClauseId={null}
        onClauseClick={noop}
      />,
    )
    expect(screen.queryByText("7 days' notice")?.tagName).not.toBe('MARK')
    expect(screen.queryByRole('button', { name: /landlord may end/i })).not.toBeInTheDocument()
  })

  it('makes a flagged clause clickable and calls onClauseClick with its id', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClauseClick = vi.fn()
    render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={onClauseClick} />,
    )
    const clause = screen.getByRole('button', { name: /landlord may end/i })
    await user.click(clause)
    expect(onClauseClick).toHaveBeenCalledWith('c4')
  })

  it('responds to Enter and Space on a flagged clause, and ignores other keys', () => {
    const onClauseClick = vi.fn()
    render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={onClauseClick} />,
    )
    const clause = screen.getByRole('button', { name: /landlord may end/i })

    clause.focus()
    act(() => {
      clause.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(onClauseClick).toHaveBeenCalledWith('c4')

    onClauseClick.mockClear()
    act(() => {
      clause.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(onClauseClick).not.toHaveBeenCalled()
  })

  it('a non-flagged clause has no button role and does not respond to clicks', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onClauseClick = vi.fn()
    render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={onClauseClick} />,
    )
    const calmClause = screen.getByText(/tenancy begins/i).closest('p')
    expect(calmClause).not.toHaveAttribute('role', 'button')
    if (calmClause) await user.click(calmClause)
    expect(onClauseClick).not.toHaveBeenCalled()
  })

  it('shows no verdict stamp while still scanning (status loading)', () => {
    render(
      <ContractPaper doc={doc} findings={[]} status="loading" activeClauseId={null} onClauseClick={noop} />,
    )
    expect(screen.queryByText(/before signing|ready to sign/i)).not.toBeInTheDocument()
  })

  it('shows "Review before signing" once a high-severity finding exists', () => {
    render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText('Review before signing')).toBeInTheDocument()
  })

  it('shows "Check before signing" when the worst finding is medium', () => {
    render(
      <ContractPaper
        doc={doc}
        findings={[{ ...highFinding, severity: 'medium' }]}
        status="ready"
        activeClauseId={null}
        onClauseClick={noop}
      />,
    )
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText('Check before signing')).toBeInTheDocument()
  })

  it('shows "Looks ready to sign" when there are no findings', () => {
    render(
      <ContractPaper doc={doc} findings={[]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(screen.getByText('Looks ready to sign')).toBeInTheDocument()
  })

  it('scrolls the active clause into view when activeClauseId is set', () => {
    const { rerender } = render(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId={null} onClauseClick={noop} />,
    )
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    rerender(
      <ContractPaper doc={doc} findings={[highFinding]} status="ready" activeClauseId="c4" onClauseClick={noop} />,
    )
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', block: 'center' }),
    )
  })
})
