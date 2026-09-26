import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  BODY_LIMITS,
  HttpError,
  checkRateLimit,
  clientIp,
  createHandler,
  isSameOrigin,
  resetRateLimit,
} from '../api/_lib/guard'
import { GeminiError } from '../api/_lib/gemini'
import type { VercelRequest, VercelResponse } from '@vercel/node'

function makeReq(opts: {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
  remoteAddress?: string
}): VercelRequest {
  return {
    method: opts.method ?? 'POST',
    headers: opts.headers ?? {},
    body: opts.body,
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as VercelRequest
}

function makeRes() {
  const res = {
    _status: undefined as number | undefined,
    _json: undefined as unknown,
    _headers: {} as Record<string, string>,
    headersSent: false,
    setHeader(name: string, value: string) {
      this._headers[name] = value
    },
    status(code: number) {
      this._status = code
      return this
    },
    json(body: unknown) {
      this._json = body
      this.headersSent = true
      return this
    },
  }
  return res as unknown as VercelResponse & typeof res
}

describe('isSameOrigin', () => {
  it('passes when there is no Origin header (server-to-server, curl)', () => {
    expect(isSameOrigin(undefined, 'pactpilot.vercel.app')).toBe(true)
  })
  it('passes when the origin host matches', () => {
    expect(isSameOrigin('https://pactpilot.vercel.app', 'pactpilot.vercel.app')).toBe(true)
  })
  it('rejects a different site', () => {
    expect(isSameOrigin('https://evil.example.com', 'pactpilot.vercel.app')).toBe(false)
  })
  it('rejects when the origin is present but the host is missing', () => {
    expect(isSameOrigin('https://pactpilot.vercel.app', undefined)).toBe(false)
  })
  it('rejects a malformed origin URL instead of throwing', () => {
    expect(isSameOrigin('not a url', 'pactpilot.vercel.app')).toBe(false)
  })
  it('rejects a different port on the same hostname', () => {
    expect(isSameOrigin('https://pactpilot.vercel.app:8080', 'pactpilot.vercel.app')).toBe(false)
  })
})

describe('clientIp', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    expect(clientIp({ 'x-real-ip': ' 1.2.3.4 ', 'x-forwarded-for': '9.9.9.9' })).toBe('1.2.3.4')
  })
  it('falls back to the first entry in x-forwarded-for', () => {
    expect(clientIp({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' })).toBe('5.6.7.8')
  })
  it('falls back to the provided fallback, then "unknown"', () => {
    expect(clientIp({}, '10.0.0.1')).toBe('10.0.0.1')
    expect(clientIp({})).toBe('unknown')
  })
  it('takes the first value when a header arrives as an array', () => {
    expect(clientIp({ 'x-real-ip': ['1.1.1.1', '2.2.2.2'] })).toBe('1.1.1.1')
  })
})

describe('checkRateLimit', () => {
  it('allows up to the max requests, then rejects', () => {
    resetRateLimit()
    for (let i = 0; i < 20; i += 1) expect(checkRateLimit('k1', 1000, 20).allowed).toBe(true)
    const blocked = checkRateLimit('k1', 1000, 20)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('allows again once the window has fully elapsed', () => {
    resetRateLimit()
    for (let i = 0; i < 20; i += 1) checkRateLimit('k2', 0, 20)
    expect(checkRateLimit('k2', 0, 20).allowed).toBe(false)
    expect(checkRateLimit('k2', 60_001, 20).allowed).toBe(true)
  })

  it('tracks separate keys independently', () => {
    resetRateLimit()
    for (let i = 0; i < 20; i += 1) checkRateLimit('a', 0, 20)
    expect(checkRateLimit('a', 0, 20).allowed).toBe(false)
    expect(checkRateLimit('b', 0, 20).allowed).toBe(true)
  })
})

describe('createHandler', () => {
  const schema = z.object({ text: z.string().min(1, 'text cannot be empty') })

  it('rejects a non-POST method with 405 and an Allow header', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const res = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(res._status).toBe(405)
    expect(res._headers.Allow).toBe('POST')
  })

  it('rejects a cross-origin request with 403', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const req = makeReq({
      headers: { origin: 'https://evil.example.com', host: 'pactpilot.vercel.app', 'content-type': 'application/json' },
      body: { text: 'x' },
    })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(403)
    expect((res._json as { error: { code: string } }).error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('rejects the wrong content type with 415', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const req = makeReq({ headers: { 'content-type': 'text/plain' }, body: { text: 'x' } })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(415)
  })

  it('rejects an over-size request with 413, before touching the body', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: 10, run: async () => ({ ok: true }) })
    const req = makeReq({
      headers: { 'content-type': 'application/json', 'content-length': '99999' },
      body: { text: 'x' },
    })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(413)
  })

  it('enforces the rate limit and sets Retry-After', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const okReq = () =>
      makeReq({ headers: { 'content-type': 'application/json' }, body: { text: 'x' }, remoteAddress: '3.3.3.3' })
    for (let i = 0; i < 20; i += 1) await handler(okReq(), makeRes())
    const res = makeRes()
    await handler(okReq(), res)
    expect(res._status).toBe(429)
    expect(res._headers['Retry-After']).toBeTruthy()
  })

  it('rejects input that fails the schema, naming the field', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: { text: '' } })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(400)
    const body = res._json as { error: { code: string; field?: string; message: string } }
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.field).toBe('text')
    expect(body.error.message).toBe('text cannot be empty')
  })

  it('parses a raw JSON-string body, as a platform might deliver it unparsed', async () => {
    resetRateLimit()
    const handler = createHandler({
      schema,
      maxBytes: BODY_LIMITS.text,
      run: async (input) => ({ got: input.text }),
    })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(200)
    expect((res._json as { got: string }).got).toBe('hello')
  })

  it('rejects an unparseable JSON-string body with 400 BAD_JSON', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: '{not json' })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(400)
    expect((res._json as { error: { code: string } }).error.code).toBe('BAD_JSON')
  })

  it('rejects an empty body with 400 EMPTY_BODY', async () => {
    resetRateLimit()
    const handler = createHandler({ schema, maxBytes: BODY_LIMITS.text, run: async () => ({ ok: true }) })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: undefined })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(400)
    expect((res._json as { error: { code: string } }).error.code).toBe('EMPTY_BODY')
  })

  it('on success, calls run() with the parsed data and returns 200 with no-store caching', async () => {
    resetRateLimit()
    let received: { text: string } | undefined
    const handler = createHandler({
      schema,
      maxBytes: BODY_LIMITS.text,
      run: async (input) => {
        received = input
        return { echoed: input.text }
      },
    })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: { text: 'hello world' } })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(200)
    expect(received).toEqual({ text: 'hello world' })
    expect((res._json as { echoed: string }).echoed).toBe('hello world')
    expect(res._headers['Cache-Control']).toBe('no-store')
  })

  it('maps a thrown GeminiError to its own status, code and Retry-After', async () => {
    resetRateLimit()
    const handler = createHandler({
      schema,
      maxBytes: BODY_LIMITS.text,
      run: async () => {
        throw new GeminiError('RATE_LIMIT')
      },
    })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: { text: 'x' } })
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(429)
    expect((res._json as { error: { code: string } }).error.code).toBe('RATE_LIMIT')
    expect(res._headers['Retry-After']).toBe('10')
  })

  it('maps an unexpected thrown error to a generic 500 without leaking details, and logs it', async () => {
    resetRateLimit()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const handler = createHandler({
        schema,
        maxBytes: BODY_LIMITS.text,
        run: async () => {
          throw new Error('super secret internal stack trace')
        },
      })
      const req = makeReq({ headers: { 'content-type': 'application/json' }, body: { text: 'x' } })
      const res = makeRes()
      await handler(req, res)
      expect(res._status).toBe(500)
      expect((res._json as { error: { code: string } }).error.code).toBe('INTERNAL')
      expect(JSON.stringify(res._json)).not.toContain('super secret')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('sets Retry-After for an HttpError that specifies one', async () => {
    resetRateLimit()
    const handler = createHandler({
      schema,
      maxBytes: BODY_LIMITS.text,
      run: async () => {
        throw new HttpError(429, 'SLOW_DOWN', 'Please wait.', { retryAfterSec: 7 })
      },
    })
    const req = makeReq({ headers: { 'content-type': 'application/json' }, body: { text: 'x' } })
    const res = makeRes()
    await handler(req, res)
    expect(res._headers['Retry-After']).toBe('7')
  })
})
