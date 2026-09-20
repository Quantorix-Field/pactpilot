import type { ZodType, ZodTypeDef } from 'zod'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-flash-latest'
const TOTAL_BUDGET_MS = 25_000
const MIN_RETRY_MS = 6_000
const MAX_ATTEMPTS = 2
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const PROMPT_CLIP = 1_500
const RESPONSE_CLIP = 6_000

export type GeminiErrorCode =
  | 'CONFIG'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'BLOCKED'
  | 'UPSTREAM'
  | 'BAD_OUTPUT'

const PUBLIC_MESSAGES: Record<GeminiErrorCode, string> = {
  CONFIG: 'The AI service is not configured yet.',
  RATE_LIMIT: 'The AI is busy right now. Wait a few seconds and try again.',
  TIMEOUT: 'The AI took too long to respond. Try again, or use a shorter document.',
  BLOCKED: 'The AI could not process this text. Try different wording.',
  UPSTREAM: 'The AI service had a problem. Try again in a moment.',
  BAD_OUTPUT: 'The AI returned an unreadable answer. Try again.',
}

const HTTP_STATUS: Record<GeminiErrorCode, number> = {
  CONFIG: 500,
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  BLOCKED: 422,
  UPSTREAM: 502,
  BAD_OUTPUT: 502,
}

/** The message is always safe to show to the user: it never contains upstream details. */
export class GeminiError extends Error {
  readonly code: GeminiErrorCode
  readonly status: number
  readonly upstream: number | undefined

  constructor(code: GeminiErrorCode, upstream?: number) {
    super(PUBLIC_MESSAGES[code])
    this.name = 'GeminiError'
    this.code = code
    this.status = HTTP_STATUS[code]
    this.upstream = upstream
  }

  get retryable(): boolean {
    if (this.code === 'RATE_LIMIT' || this.code === 'BAD_OUTPUT') return true
    return (
      this.code === 'UPSTREAM' &&
      (this.upstream === undefined || TRANSIENT_STATUSES.has(this.upstream))
    )
  }
}

export interface InlineData {
  mimeType: string
  data: string
}

export interface GeminiRequest {
  system: string
  user: string
  inlineData?: InlineData
  temperature?: number
  maxOutputTokens?: number
}

/** What the AI Inspector shows: the prompt that went in and the answer that came out. */
export interface AiTrace {
  model: string
  ms: number
  attempts: number
  system: string
  prompt: string
  response: string
}

export interface GeminiResult<T> {
  data: T
  trace: AiTrace
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters)` : text
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function stripFences(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return match ? match[1] : trimmed
}

function extractText(body: GeminiResponse): string {
  if (body.promptFeedback?.blockReason) throw new GeminiError('BLOCKED')
  const candidate = body.candidates?.[0]
  const reason = candidate?.finishReason
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') throw new GeminiError('BLOCKED')
  if (reason === 'MAX_TOKENS') throw new GeminiError('BAD_OUTPUT')
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('')
  if (!text.trim()) throw new GeminiError('BAD_OUTPUT')
  return text
}

async function callOnce(
  apiKey: string,
  model: string,
  req: GeminiRequest,
  json: boolean,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const parts: Array<Record<string, unknown>> = []
    if (req.inlineData) parts.push({ inlineData: req.inlineData })
    parts.push({ text: req.user })

    const res = await fetch(`${API_ROOT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxOutputTokens ?? 8192,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as GeminiResponse
      console.error('Gemini HTTP', res.status, (detail.error?.message ?? '').slice(0, 200))
      if (res.status === 401 || res.status === 403) throw new GeminiError('CONFIG', res.status)
      throw new GeminiError(res.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM', res.status)
    }

    return extractText((await res.json()) as GeminiResponse)
  } catch (err) {
    if (err instanceof GeminiError) throw err
    if (isAbortError(err)) throw new GeminiError('TIMEOUT')
    console.error('Gemini request failed')
    throw new GeminiError('UPSTREAM')
  } finally {
    clearTimeout(timer)
  }
}

async function run<T>(
  req: GeminiRequest,
  json: boolean,
  parse: (text: string) => T,
): Promise<GeminiResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GeminiError('CONFIG')
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL

  const started = Date.now()
  const deadline = started + TOTAL_BUDGET_MS
  let lastError = new GeminiError('UPSTREAM')

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadline - Date.now()
    if (attempt > 1 && remaining < MIN_RETRY_MS) break
    try {
      const text = await callOnce(apiKey, model, req, json, remaining - 250)
      const data = parse(text)
      return {
        data,
        trace: {
          model,
          ms: Date.now() - started,
          attempts: attempt,
          system: req.system,
          prompt: (req.inlineData ? '[PDF attached]\n' : '') + clip(req.user, PROMPT_CLIP),
          response: clip(text, RESPONSE_CLIP),
        },
      }
    } catch (err) {
      lastError = err instanceof GeminiError ? err : new GeminiError('UPSTREAM')
      if (!lastError.retryable) throw lastError
      await sleep(500 * attempt)
    }
  }
  throw lastError
}

/** Ask Gemini for JSON and validate it against a zod schema before anything trusts it. */
export function generateJson<T>(
  req: GeminiRequest,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<GeminiResult<T>> {
  return run(req, true, (text) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(stripFences(text))
    } catch {
      throw new GeminiError('BAD_OUTPUT')
    }
    const result = schema.safeParse(parsed)
    if (!result.success) {
      console.error('Gemini output failed validation', result.error.issues.slice(0, 3))
      throw new GeminiError('BAD_OUTPUT')
    }
    return result.data
  })
}

/** Plain text output, used for PDF-to-text extraction. */
export function generateText(req: GeminiRequest): Promise<GeminiResult<string>> {
  return run(req, false, (text) => text.trim())
}
