import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, askQuestion, analyzeDocument } from '../src/utils/api'

const clause = { id: 'c1', label: '§1', text: 'Rent is 18000 per month.' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('api client', () => {
  it('sends the right path and body, and returns the parsed response', async () => {
    const fetchMock = vi.fn(async (url: string, opts: RequestInit) => {
      expect(url).toBe('/api/analyze')
      const body = JSON.parse(opts.body as string)
      expect(body).toEqual({ clauses: [clause], language: 'en', simple: false })
      return new Response(JSON.stringify({ analysis: { ok: true }, trace: {} }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await analyzeDocument([clause], { language: 'en', simple: false })
    expect(res.analysis).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns a server error body into a typed ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'RATE_LIMIT', message: 'Slow down.' } }), {
            status: 429,
          }),
      ),
    )

    await expect(askQuestion([clause], 'What is the notice period?', { language: 'en' })).rejects.toMatchObject(
      { code: 'RATE_LIMIT', status: 429, message: 'Slow down.' },
    )
  })

  it('turns a network failure into ApiError with code NETWORK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(askQuestion([clause], 'q', { language: 'en' })).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('turns an unreadable response into ApiError with code BAD_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))

    await expect(askQuestion([clause], 'q', { language: 'en' })).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    })
  })

  it('aborts and reports TIMEOUT if the server never responds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, opts: RequestInit) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }),
      ),
    )

    const pending = askQuestion([clause], 'q', { language: 'en' })
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiError)
    await vi.advanceTimersByTimeAsync(32_000)
    await assertion
  })
})
