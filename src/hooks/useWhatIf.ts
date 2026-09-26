import { simulateWhatIf } from '../utils/api'
import { useAsyncAction } from './useAsyncAction'

/** Runs the what-if simulator for a single scenario. */
export function useWhatIf() {
  return useAsyncAction(simulateWhatIf)
}
