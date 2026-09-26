import type { CSSProperties, ReactElement } from 'react'
import type { Analysis, Clause } from '../types'

export interface SummaryViewProps {
  analysis: Analysis
  clauses: readonly Clause[]
  onClauseClick: (clauseId: string) => void
}

type GaugeStyle = CSSProperties & { '--v'?: number }

function readinessScore(high: number, medium: number): number {
  return Math.max(0, Math.min(100, 100 - high * 18 - medium * 6))
}

export function SummaryView({ analysis, clauses, onClauseClick }: SummaryViewProps): ReactElement {
  const high = analysis.findings.filter((f) => f.severity === 'high').length
  const medium = analysis.findings.filter((f) => f.severity === 'medium').length
  const ok = analysis.findings.filter((f) => f.severity === 'ok').length
  const score = readinessScore(high, medium)
  const gaugeStyle: GaugeStyle = { '--v': score }
  const labelById = new Map(clauses.map((c) => [c.id, c.label]))

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stack" style={{ gap: 6 }}>
            <h2>{analysis.docType}</h2>
            {analysis.parties.length > 0 && (
              <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{analysis.parties.join(' · ')}</p>
            )}
          </div>
          <div className="gauge" style={gaugeStyle}>
            <span className="gauge-value">{score}</span>
          </div>
        </div>

        <p>{analysis.summary}</p>

        {!analysis.isLegalDocument && (
          <p className="alert alert--info">
            This doesn't look like a legal document. Treat this summary with caution.
          </p>
        )}

        <div className="stat-row">
          <div className="stat">
            <b>{high}</b>
            <span>High risk</span>
          </div>
          <div className="stat">
            <b>{medium}</b>
            <span>Worth a look</span>
          </div>
          <div className="stat">
            <b>{ok}</b>
            <span>Looks fine</span>
          </div>
          <div className="stat">
            <b>{analysis.obligations.length}</b>
            <span>Obligations</span>
          </div>
        </div>
      </section>

      {analysis.keyFacts.length > 0 && (
        <section className="panel stack">
          <h3>Key facts</h3>
          <div className="stack" style={{ gap: 10 }}>
            {analysis.keyFacts.map((fact, i) => (
              <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>{fact.label}</span>
                <span className="row" style={{ gap: 6 }}>
                  {fact.value}
                  {fact.clauseId && labelById.has(fact.clauseId) && (
                    <button type="button" className="cite" onClick={() => onClauseClick(fact.clauseId)}>
                      {labelById.get(fact.clauseId)}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.nextSteps.length > 0 && (
        <section className="panel stack">
          <h3>What to do next</h3>
          <ol className="stack" style={{ gap: 10, margin: 0, paddingLeft: 20 }}>
            {analysis.nextSteps.map((step, i) => (
              <li key={i}>
                {step.action}
                {step.reason && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{step.reason}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {analysis.lawyerQuestions.length > 0 && (
        <section className="panel stack">
          <h3>Questions for a lawyer</h3>
          <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 20 }}>
            {analysis.lawyerQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
