import { downloadTextFile, slugify } from './download'
import type { Analysis } from '../types'

type Severity = Analysis['findings'][number]['severity']

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, ok: 2 }
const SEVERITY_LABEL: Record<Severity, string> = { high: 'HIGH RISK', medium: 'WATCH', ok: 'FINE' }

const LINE_WIDTH = 72

function rule(char = '-', width = LINE_WIDTH * (2 / 3)): string {
  return char.repeat(Math.round(width))
}

function section(title: string): string[] {
  return ['', title.toUpperCase(), rule()]
}

/** Word-wraps text so the file stays readable in a plain text viewer. */
function wrap(text: string, prefix: string, width = LINE_WIDTH): string {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return prefix.trimEnd()
  const indent = ' '.repeat(prefix.length)
  const lines: string[] = []
  let current = prefix
  let atStart = true
  for (const word of words) {
    const candidate = atStart ? current + word : `${current} ${word}`
    if (candidate.length > width && !atStart) {
      lines.push(current)
      current = indent + word
    } else {
      current = candidate
    }
    atStart = false
  }
  lines.push(current)
  return lines.join('\n')
}

function bullet(text: string): string {
  return wrap(text, '[ ] ')
}

function plainBullet(text: string): string {
  return wrap(text, '- ')
}

export function buildChecklistText(
  analysis: Analysis,
  docName: string,
  generatedAt: Date = new Date(),
): string {
  const lines: string[] = []

  lines.push('PACTPILOT — CONTRACT CHECKLIST')
  lines.push(rule('=', LINE_WIDTH))
  lines.push(`Document: ${docName || '(untitled)'}`)
  lines.push(`Type: ${analysis.docType}`)
  if (analysis.parties.length > 0) lines.push(`Parties: ${analysis.parties.join(', ')}`)
  lines.push(`Generated: ${generatedAt.toISOString().slice(0, 10)}`)

  lines.push(...section('Summary'))
  lines.push(wrap(analysis.summary, ''))

  if (analysis.keyFacts.length > 0) {
    lines.push(...section('Key facts'))
    for (const f of analysis.keyFacts) lines.push(plainBullet(`${f.label}: ${f.value}`))
  }

  if (analysis.findings.length > 0) {
    lines.push(...section('Risks to review'))
    const sorted = [...analysis.findings].sort(
      (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    )
    for (const f of sorted) {
      lines.push(bullet(`[${SEVERITY_LABEL[f.severity]}] ${f.title} — ${f.explanation}`))
      if (f.suggestion) lines.push(wrap(`\u2192 ${f.suggestion}`, '      '))
    }
  }

  if (analysis.obligations.length > 0) {
    lines.push(...section('Obligations and dates'))
    for (const o of analysis.obligations) lines.push(bullet(`${o.title} \u2014 ${o.dueLabel}`))
  }

  if (analysis.nextSteps.length > 0) {
    lines.push(...section('Before you sign'))
    for (const s of analysis.nextSteps) {
      lines.push(bullet(s.reason ? `${s.action} (${s.reason})` : s.action))
    }
  }

  if (analysis.lawyerQuestions.length > 0) {
    lines.push(...section('Questions for a lawyer'))
    for (const q of analysis.lawyerQuestions) lines.push(bullet(q))
  }

  lines.push('')
  lines.push(rule('=', LINE_WIDTH))
  lines.push('PactPilot provides information, not legal advice.')
  lines.push('')

  return lines.join('\n')
}

/** Builds the checklist and starts the browser download. */
export function downloadChecklist(analysis: Analysis, docName: string): void {
  const text = buildChecklistText(analysis, docName)
  downloadTextFile(`pactpilot-checklist-${slugify(docName)}.txt`, text, 'text/plain;charset=utf-8')
}
