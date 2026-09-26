import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react'
import { LIMITS } from '../api/_lib/limits'
import { ContractPaper } from './components/ContractPaper'
import { Disclaimer } from './components/Disclaimer'
import { Hero } from './components/Hero'
import { SummaryView } from './components/SummaryView'
import { useAnalysis } from './hooks/useAnalysis'
import { useAsyncAction } from './hooks/useAsyncAction'
import type { Language } from './types'
import { extractPdfText, fileToBase64 } from './utils/api'
import { splitIntoClauses } from './utils/clauseSplitter'

export default function App(): ReactElement {
  const [text, setText] = useState('')
  const [docName, setDocName] = useState('Your contract')
  const [language, setLanguage] = useState<Language>('en')
  const [perspective, setPerspective] = useState('')
  const [simple, setSimple] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const [activeClauseId, setActiveClauseId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const analysis = useAnalysis()
  const extract = useAsyncAction(extractPdfText)
  const split = useMemo(() => splitIntoClauses(text), [text])

  useEffect(() => {
    if (extract.state.status === 'ready') setText(extract.state.value.text)
  }, [extract.state])

  async function handleFile(file: File): Promise<void> {
    setInputError(null)
    if (file.type !== 'application/pdf') {
      setInputError('Please choose a PDF file.')
      return
    }
    if (file.size > LIMITS.maxPdfBytes) {
      setInputError('That PDF is larger than 3 MB. Try a smaller file, or paste the text instead.')
      return
    }
    try {
      const base64 = await fileToBase64(file)
      await extract.run(base64)
      setDocName(file.name.replace(/\.pdf$/i, ''))
    } catch {
      setInputError('Could not read that file. Try again, or paste the text instead.')
    }
  }

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) void handleFile(file)
    e.target.value = ''
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(true)
  }

  async function handleAnalyze(): Promise<void> {
    if (split.clauses.length === 0) {
      setInputError('Paste or upload a contract first.')
      return
    }
    if (split.tooLong) {
      setInputError('This document is too long for one pass. Try a shorter contract.')
      return
    }
    setInputError(null)
    setActiveClauseId(null)
    await analysis.run(split.clauses, {
      perspective: perspective.trim() || undefined,
      language,
      simple,
    })
  }

  function handleEdit(): void {
    analysis.reset()
    setActiveClauseId(null)
  }

  const busy = analysis.state.status === 'loading' || extract.state.status === 'loading'
  const showInput = analysis.state.status === 'idle' || analysis.state.status === 'error'

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <span className="brand">
          §<small>PACTPILOT</small>
        </span>
        {!showInput && (
          <button type="button" className="btn btn--ghost" onClick={handleEdit}>
            Edit document
          </button>
        )}
      </header>

      {showInput && <Hero />}

      <main id="main" className="stack">
        {showInput && (
          <section className="panel stack" aria-labelledby="input-heading">
            <h2 id="input-heading">Paste your contract, or upload a PDF</h2>

            <label htmlFor="contract-text" className="sr-only">
              Contract text
            </label>
            <textarea
              id="contract-text"
              className="paper-input"
              placeholder="Paste your lease, offer letter, or contract text here…"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setInputError(null)
              }}
            />

            <div
              className={`dropzone${dragOver ? ' is-over' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <p>Or drop a PDF here (up to 3 MB), or</p>
              <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
                Choose PDF
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={onFileInputChange}
              />
            </div>

            {extract.state.status === 'loading' && <p className="alert alert--info">Reading your PDF…</p>}
            {extract.state.status === 'error' && (
              <p className="alert alert--error" role="alert">
                {extract.state.message}
              </p>
            )}

            <div className="row">
              <div className="seg" role="group" aria-label="Language">
                <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
                  English
                </button>
                <button type="button" aria-pressed={language === 'hi'} onClick={() => setLanguage('hi')}>
                  हिन्दी
                </button>
              </div>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={simple} onChange={(e) => setSimple(e.target.checked)} />
                Simpler language
              </label>
            </div>

            <label htmlFor="perspective" className="sr-only">
              Your role in this contract
            </label>
            <input
              id="perspective"
              className="paper-input"
              style={{ minHeight: 'auto', padding: '10px 14px' }}
              placeholder="Your role, e.g. tenant, employee, freelancer (optional)"
              value={perspective}
              onChange={(e) => setPerspective(e.target.value)}
            />

            {inputError && (
              <p className="alert alert--error" role="alert">
                {inputError}
              </p>
            )}

            <div className="row">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void handleAnalyze()}
                disabled={busy}
              >
                {analysis.state.status === 'loading' ? 'Analyzing…' : 'Analyze contract'}
              </button>
              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {split.chars.toLocaleString()} characters
              </span>
            </div>

            {analysis.state.status === 'error' && (
              <div className="alert alert--error" role="alert">
                {analysis.state.message}
              </div>
            )}
          </section>
        )}

        {!showInput && (
          <div className="workspace">
            <ContractPaper
              doc={{ name: docName, clauses: split.clauses }}
              findings={analysis.state.status === 'ready' ? analysis.state.value.analysis.findings : []}
              status={analysis.state.status === 'loading' ? 'loading' : 'ready'}
              activeClauseId={activeClauseId}
              onClauseClick={setActiveClauseId}
            />
            <div className="sticky">
              {analysis.state.status === 'ready' ? (
                <SummaryView
                  analysis={analysis.state.value.analysis}
                  clauses={split.clauses}
                  onClauseClick={setActiveClauseId}
                />
              ) : (
                <div className="panel stack">
                  <p className="skeleton" style={{ width: '70%' }} />
                  <p className="skeleton" style={{ width: '100%' }} />
                  <p className="skeleton" style={{ width: '90%' }} />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <Disclaimer />
    </div>
  )
}
