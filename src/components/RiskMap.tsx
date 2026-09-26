import type { KeyboardEvent, ReactElement } from 'react'
import type { Clause, Finding, Severity } from '../types'

export interface RiskMapProps {
  findings: readonly Finding[]
  clauses: readonly Clause[]
  activeClauseId: string | null
  onClauseClick: (clauseId: string) => void
}

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High risk',
  medium: 'Worth a look',
  ok: 'Looks fine',
}

function noteClass(severity: Severity): 'note--high' | 'note--mid' | 'note--ok' {
  if (severity === 'high') return 'note--high'
  if (severity === 'medium') return 'note--mid'
  return 'note--ok'
}

function chipClass(severity: Severity): 'chip--high' | 'chip--mid' | 'chip--verified' {
  if (severity === 'high') return 'chip--high'
  if (severity === 'medium') return 'chip--mid'
  return 'chip--verified'
}

export function RiskMap({ findings, clauses, activeClauseId, onClauseClick }: RiskMapProps): ReactElement {
  const labelById = new Map(clauses.map((c) => [c.id, c.label]))
  const order: Record<Severity, number> = { high: 0, medium: 1, ok: 2 }
  const flagged = findings
    .filter((f) => f.verified && f.clauseId && labelById.has(f.clauseId))
    .sort((a, b) => order[a.severity] - order[b.severity])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, clauseId: string): void {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onClauseClick(clauseId)
  }

  if (flagged.length === 0) {
    return (
      <div className="panel stack">
        <p className="alert alert--info">Nothing flagged in this pass — no clauses stood out as risky.</p>
      </div>
    )
  }

  return (
    <div className="stack">
      {flagged.map((finding, i) => {
        const clauseId = finding.clauseId
        return (
          <div
            key={i}
            className={`note ${noteClass(finding.severity)}${activeClauseId === clauseId ? ' is-active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onClauseClick(clauseId)}
            onKeyDown={(e) => onKeyDown(e, clauseId)}
          >
            <div className="note-head">
              <b>{finding.title}</b>
              <span className={`chip ${chipClass(finding.severity)}`}>{SEVERITY_LABEL[finding.severity]}</span>
              <span className="chip">{labelById.get(clauseId)}</span>
            </div>
            <div className="note-body">{finding.explanation}</div>
            {finding.suggestion && (
              <div className="note-body" style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 6 }}>
                Suggestion: {finding.suggestion}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
