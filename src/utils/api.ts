import type {
  AnalyzeResponse,
  ApiErrorBody,
  AskResponse,
  Clause,
  CompareResponse,
  ExtractResponse,
  Language,
  WhatIfResponse,
} from '../types'

const TIMEOUT_MS = 32_000

/** Thrown for every failed call: `.message` is always safe to show to the user. */
export class ApiError extends Error {
  readonly code: string
  readonly field: string | undefined
  readonly status: number

  constructor(status: number, code: string, message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

async function post<TRes>(path: string, body: unknown): Promise<TRes> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (isAbort(err)) {
      throw new ApiError(408, 'TIMEOUT', 'That took too long. Check your connection and try again.')
    }
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'The server sent an unreadable response.')
  }

  if (!res.ok) {
    const errBody = json as Partial<ApiErrorBody>
    throw new ApiError(
      res.status,
      errBody.error?.code ?? 'UNKNOWN',
      errBody.error?.message ?? 'Something went wrong. Try again.',
      errBody.error?.field,
    )
  }

  return json as TRes
}

export interface CommonInput {
  perspective?: string | undefined
  language: Language
}

export function analyzeDocument(
  clauses: readonly Clause[],
  input: CommonInput & { simple: boolean },
): Promise<AnalyzeResponse> {
  return post('/api/analyze', { clauses, ...input })
}

export function askQuestion(
  clauses: readonly Clause[],
  question: string,
  input: CommonInput,
): Promise<AskResponse> {
  return post('/api/ask', { clauses, question, ...input })
}

export function simulateWhatIf(
  clauses: readonly Clause[],
  scenario: string,
  input: CommonInput,
): Promise<WhatIfResponse> {
  return post('/api/whatif', { clauses, scenario, ...input })
}

export function compareDocuments(
  a: { name?: string; clauses: readonly Clause[] },
  b: { name?: string; clauses: readonly Clause[] },
  input: CommonInput,
): Promise<CompareResponse> {
  return post('/api/compare', { a, b, ...input })
}

export function extractPdfText(base64: string): Promise<ExtractResponse> {
  return post('/api/extract', { mimeType: 'application/pdf', data: base64 })
}

/** Reads a File as base64, without the "data:...;base64," prefix. Used for the PDF upload flow. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read that file.'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}
