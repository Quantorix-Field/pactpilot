import { askQuestion } from '../utils/api'
import { useAsyncAction } from './useAsyncAction'

/** Answers a single question, grounded in the document. */
export function useAsk() {
  return useAsyncAction(askQuestion)
}
