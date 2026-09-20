import { z } from 'zod'
import { LIMITS } from './limits.js'

/* ---------- Incoming requests: everything the browser sends is validated ---------- */

function stripControl(input: string): string {
  let out = ''
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) out += ch
  }
  return out
}

const userText = (min: number, max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => stripControl(s).trim())
    .refine((s) => s.length >= min, {
      message: min <= 1 ? 'This field cannot be empty.' : `Enter at least ${min} characters.`,
    })

const LanguageSchema = z.enum(['en', 'hi']).default('en')
const PerspectiveSchema = userText(1, LIMITS.maxPerspectiveChars).optional()

export const ClauseInSchema = z.object({
  id: z.string().regex(/^c\d{1,3}$/),
  label: userText(1, 24),
  text: userText(1, LIMITS.maxClauseChars),
})

export const ClausesSchema = z
  .array(ClauseInSchema)
  .min(1, 'Add a document first.')
  .max(LIMITS.maxClauses, 'This document has too many clauses.')
  .refine((cs) => cs.reduce((n, c) => n + c.text.length, 0) <= LIMITS.maxDocChars, {
    message: 'This document is too long.',
  })
  .refine((cs) => new Set(cs.map((c) => c.id)).size === cs.length, {
    message: 'Clause ids must be unique.',
  })

const DocumentSchema = z.object({
  name: userText(1, 80).optional(),
  clauses: ClausesSchema,
})

export const ExtractRequestSchema = z.object({
  mimeType: z.literal('application/pdf'),
  data: z
    .string()
    .min(100, 'That file looks empty.')
    .max(LIMITS.maxPdfBase64Chars, 'That PDF is too large.')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid file data.'),
})

export const AnalyzeRequestSchema = z.object({
  clauses: ClausesSchema,
  perspective: PerspectiveSchema,
  language: LanguageSchema,
  simple: z.boolean().default(false),
})

export const WhatIfRequestSchema = z.object({
  clauses: ClausesSchema,
  perspective: PerspectiveSchema,
  scenario: userText(4, LIMITS.maxScenarioChars),
  language: LanguageSchema,
})

export const AskRequestSchema = z.object({
  clauses: ClausesSchema,
  perspective: PerspectiveSchema,
  question: userText(3, LIMITS.maxQuestionChars),
  language: LanguageSchema,
})

export const CompareRequestSchema = z.object({
  a: DocumentSchema,
  b: DocumentSchema,
  perspective: PerspectiveSchema,
  language: LanguageSchema,
})

/* ---------- AI output: parsed defensively, never trusted ---------- */

const req = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, max))

const opt = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => (s ?? '').trim().slice(0, max))

const clauseId = z
  .string()
  .nullish()
  .transform((s) => (s ?? '').trim().toLowerCase().slice(0, 12))

const isoDate = z
  .string()
  .nullish()
  .transform((s) => {
    const v = (s ?? '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  })

const capped = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(item).transform((items) => items.slice(0, max))

const optList = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(item)
    .nullish()
    .transform((items) => (items ?? []).slice(0, max))

/** The model can never mark its own work as verified: this is always false until verify.ts runs. */
const unverified = z.unknown().transform((): boolean => false)

export const SEVERITIES = ['high', 'medium', 'ok'] as const
export const OBLIGATION_KINDS = ['payment', 'notice', 'deadline', 'renewal', 'other'] as const
export const RECURRENCES = ['once', 'weekly', 'monthly', 'yearly'] as const

const severity = z.enum(SEVERITIES).catch('medium')

export const CitationSchema = z.object({
  clauseId,
  quote: opt(400),
  verified: unverified,
})

const KeyFactSchema = z.object({
  label: req(60),
  value: req(160),
  clauseId,
})

export const FindingSchema = z.object({
  clauseId,
  severity,
  title: req(90),
  explanation: req(600),
  quote: opt(500),
  suggestion: opt(400),
  verified: unverified,
})

const ContradictionSchema = z.object({
  clauseIds: capped(clauseId, 4),
  issue: req(500),
  severity,
})

const ObligationSchema = z.object({
  title: req(120),
  dueLabel: req(120),
  kind: z.enum(OBLIGATION_KINDS).catch('other'),
  clauseId,
  date: isoDate,
  recurrence: z
    .enum(RECURRENCES)
    .nullish()
    .transform((v) => v ?? null)
    .catch(null),
})

const NextStepSchema = z.object({
  action: req(200),
  reason: opt(300),
})

export const AnalysisSchema = z.object({
  isLegalDocument: z.boolean().default(true),
  docType: req(80),
  parties: optList(req(40), 4),
  summary: req(900),
  keyFacts: optList(KeyFactSchema, 8),
  findings: capped(FindingSchema, 14),
  contradictions: optList(ContradictionSchema, 5),
  obligations: optList(ObligationSchema, 12),
  nextSteps: capped(NextStepSchema, 6),
  lawyerQuestions: optList(req(240), 8),
})

const WhatIfStepSchema = z.object({
  title: req(120),
  detail: req(500),
  clauseId,
  quote: opt(400),
  verified: unverified,
})

export const WhatIfSchema = z.object({
  covered: z.boolean().default(true),
  outcome: z.enum(['good', 'mixed', 'bad', 'unclear']).catch('unclear'),
  answer: req(700),
  steps: capped(WhatIfStepSchema, 7),
  options: optList(req(300), 5),
  caveat: opt(300),
})

export const AskSchema = z.object({
  answerable: z.boolean(),
  answer: req(1200),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
  citations: optList(CitationSchema, 4),
})

const ChangeSchema = z.object({
  topic: req(120),
  a: req(300),
  b: req(300),
  favors: z.enum(['a', 'b', 'neither']).catch('neither'),
  why: req(400),
  aClause: clauseId,
  aQuote: opt(400),
  aVerified: unverified,
  bClause: clauseId,
  bQuote: opt(400),
  bVerified: unverified,
})

export const CompareSchema = z.object({
  overview: req(700),
  better: z.enum(['a', 'b', 'balanced', 'unclear']).catch('unclear'),
  differences: capped(ChangeSchema, 12),
})

/* ---------- Types shared with the browser (type-only imports, erased at build time) ---------- */

export type ClauseIn = z.infer<typeof ClauseInSchema>
export type Severity = (typeof SEVERITIES)[number]
export type Citation = z.infer<typeof CitationSchema>
export type Finding = z.infer<typeof FindingSchema>
export type Analysis = z.infer<typeof AnalysisSchema>
export type Obligation = Analysis['obligations'][number]
export type WhatIfResult = z.infer<typeof WhatIfSchema>
export type AskResult = z.infer<typeof AskSchema>
export type CompareResult = z.infer<typeof CompareSchema>
