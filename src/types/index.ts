import type { AiTrace } from '../../api/_lib/gemini'
import type {
  Analysis,
  AskResult,
  Citation,
  ClauseIn,
  CompareResult,
  Finding,
  Obligation,
  Severity,
  WhatIfResult,
} from '../../api/_lib/schemas'

/* Shared with the server: type-only imports, erased at build time, so no code is duplicated. */
export type {
  AiTrace,
  Analysis,
  AskResult,
  Citation,
  CompareResult,
  Finding,
  Obligation,
  Severity,
  WhatIfResult,
}

export type Clause = ClauseIn
export type Language = 'en' | 'hi'

export interface Doc {
  name: string
  clauses: readonly Clause[]
}

/** The reader's context: it changes how every AI answer is judged and written. */
export interface Settings {
  perspective: string
  language: Language
  simple: boolean
}

/* API response shapes: each answer comes with a trace for the AI Inspector. */
export interface AnalyzeResponse {
  analysis: Analysis
  trace: AiTrace
}
export interface WhatIfResponse {
  result: WhatIfResult
  trace: AiTrace
}
export interface AskResponse {
  result: AskResult
  trace: AiTrace
}
export interface CompareResponse {
  result: CompareResult
  trace: AiTrace
}
export interface ExtractResponse {
  text: string
  chars: number
  trace: AiTrace
}

export interface ApiErrorBody {
  error: { code: string; message: string; field?: string }
}

/** One shape for every request the interface makes. */
export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; code: string; message: string }
  | { status: 'ready'; value: T }

export type FeatureId = 'overview' | 'risks' | 'whatif' | 'compare' | 'ask' | 'timeline' | 'brief'
