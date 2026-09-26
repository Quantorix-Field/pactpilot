import { analyzeDocument } from '../utils/api'
import { useAsyncAction } from './useAsyncAction'

/** Runs the full contract analysis: summary, risks, obligations, next steps. */
export function useAnalysis() {
  return useAsyncAction(analyzeDocument)
}
