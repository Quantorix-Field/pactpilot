import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsyncAction } from '../src/hooks/useAsyncAction'
import { ApiError } from '../src/utils/api'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAsyncAction', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useAsyncAction(async () => 'x'))
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('goes through loading to ready with the resolved value', async () => {
    const fn = vi.fn(async (x: number) => x * 2)
    const { result } = renderHook(() => useAsyncAction(fn))

    let runPromise!: Promise<void>
    act(() => {
      runPromise = result.current.run(5)
    })
    expect(result.current.state.status).toBe('loading')

    await act(async () => {
      await runPromise
    })
    expect(result.current.state).toEqual({ status: 'ready', value: 10 })
  })

  it('turns a thrown ApiError into a typed error state', async () => {
    const fn = vi.fn(async () => {
      throw new ApiError(429, 'RATE_LIMIT', 'Slow down.')
    })
    const { result } = renderHook(() => useAsyncAction(fn))

    await act(async () => {
      await result.current.run()
    })
    expect(result.current.state).toEqual({ status: 'error', code: 'RATE_LIMIT', message: 'Slow down.' })
  })

  it('turns a non-ApiError throw into a generic error state', async () => {
    const fn = vi.fn(async () => {
      throw new Error('unexpected')
    })
    const { result } = renderHook(() => useAsyncAction(fn))

    await act(async () => {
      await result.current.run()
    })
    expect(result.current.state).toEqual({
      status: 'error',
      code: 'UNKNOWN',
      message: 'Something went wrong. Try again.',
    })
  })

  it('discards a stale result when a newer call has already started', async () => {
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    let call = 0
    const fn = vi.fn(() => (call++ === 0 ? d1.promise : d2.promise))
    const { result } = renderHook(() => useAsyncAction(fn))

    let p1!: Promise<void>
    let p2!: Promise<void>
    act(() => {
      p1 = result.current.run('first')
    })
    act(() => {
      p2 = result.current.run('second')
    })

    d2.resolve('second-result')
    await act(async () => {
      await p2
    })
    expect(result.current.state).toEqual({ status: 'ready', value: 'second-result' })

    d1.resolve('first-result (stale)')
    await act(async () => {
      await p1
    })
    expect(result.current.state).toEqual({ status: 'ready', value: 'second-result' })
  })

  it('a stale rejection does not overwrite a newer successful result', async () => {
    const d1 = deferred<string>()
    const d2 = deferred<string>()
    let call = 0
    const fn = vi.fn(() => (call++ === 0 ? d1.promise : d2.promise))
    const { result } = renderHook(() => useAsyncAction(fn))

    let p1!: Promise<void>
    act(() => {
      p1 = result.current.run('first')
    })
    act(() => {
      result.current.run('second')
    })

    d2.resolve('good-result')
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', value: 'good-result' }))

    d1.reject(new Error('stale failure'))
    await act(async () => {
      await p1
    })
    expect(result.current.state).toEqual({ status: 'ready', value: 'good-result' })
  })

  it('reset() returns to idle and ignores any call still in flight', async () => {
    const d1 = deferred<string>()
    const fn = vi.fn(() => d1.promise)
    const { result } = renderHook(() => useAsyncAction(fn))

    let p1!: Promise<void>
    act(() => {
      p1 = result.current.run()
    })
    act(() => {
      result.current.reset()
    })
    expect(result.current.state).toEqual({ status: 'idle' })

    d1.resolve('late value')
    await act(async () => {
      await p1
    })
    expect(result.current.state).toEqual({ status: 'idle' })
  })

  it('passes every argument through to the wrapped function', async () => {
    const fn = vi.fn(async (a: string, b: number) => `${a}-${b}`)
    const { result } = renderHook(() => useAsyncAction(fn))

    await act(async () => {
      await result.current.run('x', 7)
    })
    expect(fn).toHaveBeenCalledWith('x', 7)
    expect(result.current.state).toEqual({ status: 'ready', value: 'x-7' })
  })
})
