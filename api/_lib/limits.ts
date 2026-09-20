/** One source of truth for size limits, shared by the browser and the serverless functions. */
export const LIMITS = {
  maxClauses: 120,
  maxClauseChars: 3_000,
  maxDocChars: 40_000,
  maxQuestionChars: 500,
  maxScenarioChars: 400,
  maxPerspectiveChars: 60,
  maxPdfBytes: 3_000_000,
  maxPdfBase64Chars: 4_000_000,
} as const
