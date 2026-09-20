import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { ZodType, ZodTypeDef } from 'zod'
import { GeminiError } from './gemini.js'

/** Body size caps in bytes. Vercel itself rejects anything above roughly 4.5 MB. */
export const BODY_LIMITS = { text: 400_000, pdf: 4_200_000 } as const

const WINDOW_MS = 60_000
const MAX_REQUESTS = 20
const MAX_TRACKED = 5_000

type HeaderMap = Record<string, string | string[] | undefined>

/** An error that is safe to show to the user, with the HTTP status to send. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | undefined
  readonly retryAfterSec: number | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    extra: { field?: string; retryAfterSec?: number } = {},
  ) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.field = extra.field
    this.retryAfterSec = extra.retryAfterSec
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Requests with no Origin header (curl, server-to-server) pass; a different site does not. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export function clientIp(headers: HeaderMap, fallback?: string): string {
  const real = first(headers['x-real-ip'])?.trim()
  if (real) return real
  const forwarded = first(headers['x-forwarded-for'])?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return fallback ? fallback : 'unknown'
}

/* ---------- Rate limiting: sliding window per visitor, kept in memory ---------- */

const hits = new Map<string, number[]>()

export interface RateResult {
  allowed: boolean
  retryAfterSec: number
}

function prune(cutoff: number): void {
  for (const [key, times] of hits) {
    if (times[times.length - 1] <= cutoff) hits.delete(key)
  }
  if (hits.size > MAX_TRACKED) hits.clear()
}

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
  max: number = MAX_REQUESTS,
): RateResult {
  const cutoff = now - WINDOW_MS
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)
  if (recent.length >= max) {
    hits.set(key, recent)
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)),
    }
  }
  recent.push(now)
  hits.set(key, recent)
  if (hits.size > MAX_TRACKED) prune(cutoff)
  return { allowed: true, retryAfterSec: 0 }
}

export function resetRateLimit(): void {
  hits.clear()
}

/* ---------- Request and response plumbing ---------- */

function readBody(req: VercelRequest): unknown {
  let body: unknown
  try {
    body = req.body
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'The request was not valid JSON.')
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      throw new HttpError(400, 'BAD_JSON', 'The request was not valid JSON.')
    }
  }
  if (body === undefined || body === null) {
    throw new HttpError(400, 'EMPTY_BODY', 'The request was empty.')
  }
  return body
}

function sendJson(res: VercelResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.status(status).json(body)
}

function sendError(res: VercelResponse, err: unknown): void {
  if (err instanceof HttpError) {
    if (err.retryAfterSec !== undefined) res.setHeader('Retry-After', String(err.retryAfterSec))
    sendJson(res, err.status, {
      error: {
        code: err.code,
        message: err.message,
        ...(err.field ? { field: err.field } : {}),
      },
    })
    return
  }
  if (err instanceof GeminiError) {
    if (err.code === 'RATE_LIMIT') res.setHeader('Retry-After', '10')
    sendJson(res, err.status, { error: { code: err.code, message: err.message } })
    return
  }
  console.error('Unhandled API error', err instanceof Error ? err.name : typeof err)
  sendJson(res, 500, {
    error: { code: 'INTERNAL', message: 'Something went wrong on our side. Try again.' },
  })
}

export interface HandlerOptions<T> {
  schema: ZodType<T, ZodTypeDef, unknown>
  maxBytes: number
  run: (input: T) => Promise<Record<string, unknown>>
}

/**
 * Wraps an endpoint with every check it needs, in order: method, origin, content type,
 * size, rate limit, then validation. The endpoint's own code only ever sees valid input.
 */
export function createHandler<T>(options: HandlerOptions<T>) {
  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'This endpoint only accepts POST requests.')
      }

      const host = first(req.headers['x-forwarded-host']) ?? first(req.headers.host)
      if (!isSameOrigin(first(req.headers.origin), host)) {
        throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Requests from other sites are not allowed.')
      }

      const contentType = first(req.headers['content-type']) ?? ''
      if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'UNSUPPORTED_TYPE', 'Send the request as JSON.')
      }

      const length = Number(first(req.headers['content-length']))
      if (Number.isFinite(length) && length > options.maxBytes) {
        throw new HttpError(413, 'TOO_LARGE', 'That request is too large.')
      }

      const rate = checkRateLimit(clientIp(req.headers, req.socket?.remoteAddress))
      if (!rate.allowed) {
        throw new HttpError(
          429,
          'RATE_LIMIT',
          `You are sending requests too fast. Try again in ${rate.retryAfterSec} seconds.`,
          { retryAfterSec: rate.retryAfterSec },
        )
      }

      const parsed = options.schema.safeParse(readBody(req))
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        throw new HttpError(400, 'INVALID_INPUT', issue?.message ?? 'The request was not valid.', {
          field: issue?.path.join('.'),
        })
      }

      sendJson(res, 200, await options.run(parsed.data))
    } catch (err) {
      sendError(res, err)
    }
  }
}
