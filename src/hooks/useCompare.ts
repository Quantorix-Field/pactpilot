import { compareDocuments } from '../utils/api'
import { useAsyncAction } from './useAsyncAction'

/** Compares two documents clause by clause. */
export function useCompare() {
  return useAsyncAction(compareDocuments)
}
