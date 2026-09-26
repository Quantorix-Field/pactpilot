import { useCallback, useRef, useState } from 'react'
import { ApiError } from '../utils/api'
import type { AsyncState } from '../types'

export interface AsyncAction<TArgs extends unknown[], TValue> {
  state: AsyncState<TValue>
  run: (...args: TArgs) => Promise<void>
  reset: () => void
}

/**
 * Wraps an API call with idle/loading/ready/error state. If a newer call starts before an
 * older one resolves, the older result is discarded — so typing a second question before the
 * first answer arrives can never let the first answer overwrite the second on screen.
 */
export function useAsyncAction<TArgs extends unknown[], TValue>(
  fn: (...args: TArgs) => Promise<TValue>,
): AsyncAction<TArgs, TValue> {
  const [state, setState] = useState<AsyncState<TValue>>({ status: 'idle' })
  const callId = useRef(0)

  const run = useCallback(
    async (...args: TArgs) => {
      const id = (callId.current += 1)
      setState({ status: 'loading' })
      try {
        const value = await fn(...args)
        if (callId.current === id) setState({ status: 'ready', value })
      } catch (err) {
        if (callId.current !== id) return
        if (err instanceof ApiError) {
          setState({ status: 'error', code: err.code, message: err.message })
        } else {
          setState({ status: 'error', code: 'UNKNOWN', message: 'Something went wrong. Try again.' })
        }
      }
    },
    [fn],
  )

  const reset = useCallback(() => {
    callId.current += 1
    setState({ status: 'idle' })
  }, [])

  return { state, run, reset }
}
