import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import { splitForHighlight } from '../utils/quoteRange'
import type { Doc, Finding, Severity } from '../types'

export interface ContractPaperProps {
  doc: Doc
  findings: readonly Finding[]
  status: 'loading' | 'ready'
  activeClauseId: string | null
  onClauseClick: (clauseId: string) => void
}

function sevClass(severity: Severity): 'high' | 'mid' | 'ok' {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'mid'
  return 'ok'
}

function verdict(findings: readonly Finding[]): { tone?: 'ok' | 'warn'; label: string } {
  if (findings.some((f) => f.severity === 'high')) return { label: 'Review before signing' }
  if (findings.some((f) => f.severity === 'medium')) return { tone: 'warn', label: 'Check before signing' }
  return { tone: 'ok', label: 'Looks ready to sign' }
}

export function ContractPaper({
  doc,
  findings,
  status,
  activeClauseId,
  onClauseClick,
}: ContractPaperProps): ReactElement {
  const [phase, setPhase] = useState<'scanning' | 'justScanned' | 'marked'>(
    status === 'ready' ? 'marked' : 'scanning',
  )

  useEffect(() => {
    if (status === 'loading') {
      setPhase('scanning')
      return
    }
    setPhase('justScanned')
    const timer = setTimeout(() => setPhase('marked'), 1450)
    return () => clearTimeout(timer)
  }, [status])

  useEffect(() => {
    if (!activeClauseId) return
    document.getElementById(`clause-${activeClauseId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeClauseId])

  const byClause = useMemo(() => {
    const map = new Map<string, Finding[]>()
    const order: Record<Severity, number> = { high: 0, medium: 1, ok: 2 }
    for (const finding of findings) {
      if (!finding.verified || !finding.clauseId || !finding.quote) continue
      const list = map.get(finding.clauseId) ?? []
      list.push(finding)
      map.set(finding.clauseId, list)
    }
    for (const list of map.values()) list.sort((a, b) => order[a.severity] - order[b.severity])
    return map
  }, [findings])

  function onKeyDown(e: KeyboardEvent<HTMLParagraphElement>, id: string): void {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onClauseClick(id)
  }

  const paperClass = `paper${phase === 'scanning' ? ' is-scanning' : ''}${
    phase === 'justScanned' ? ' just-scanned' : ''
  }${phase === 'marked' ? ' is-marked' : ''}`
  const { tone, label } = verdict(findings)

  return (
    <section className={paperClass} aria-label={`${doc.name}, analyzed`}>
      <div className="beam" aria-hidden="true" />
      <p className="paper-title">{doc.name}</p>

      {doc.clauses.map((clause) => {
        const matches = byClause.get(clause.id) ?? []
        const top = matches[0]
        const flagged = matches.length > 0
        const segments = top
          ? splitForHighlight(clause.text, top.quote ?? '')
          : [{ text: clause.text, highlighted: false }]
        const clauseClass = `clause${flagged ? ' clause--flagged' : ''}${
          activeClauseId === clause.id ? ' is-active' : ''
        }`

        return (
          <p
            key={clause.id}
            id={`clause-${clause.id}`}
            className={clauseClass}
            style={{ whiteSpace: 'pre-wrap' }}
            role={flagged ? 'button' : undefined}
            tabIndex={flagged ? 0 : undefined}
            onClick={flagged ? () => onClauseClick(clause.id) : undefined}
            onKeyDown={flagged ? (e) => onKeyDown(e, clause.id) : undefined}
          >
            <span className="clause-no">{clause.label}</span>
            {segments.map((segment, i) =>
              segment.highlighted && top ? (
                <mark key={i} className={`mark mark--${sevClass(top.severity)}`}>
                  {segment.text}
                </mark>
              ) : (
                <span key={i}>{segment.text}</span>
              ),
            )}
          </p>
        )
      })}

      {phase !== 'scanning' && (
        <span className="stamp" data-tone={tone}>
          {label}
        </span>
      )}
    </section>
  )
}
