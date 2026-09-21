import { generateJson } from './_lib/gemini.js'
import { BODY_LIMITS, createHandler } from './_lib/guard.js'
import { buildAnalyzePrompt } from './_lib/prompts.js'
import { AnalysisSchema, AnalyzeRequestSchema } from './_lib/schemas.js'
import { verifyAnalysis } from './_lib/verify.js'

export default createHandler({
  schema: AnalyzeRequestSchema,
  maxBytes: BODY_LIMITS.text,
  run: async ({ clauses, perspective, language, simple }) => {
    const { system, user } = buildAnalyzePrompt({ clauses, perspective, language, simple })

    const { data, trace } = await generateJson(
      { system, user, maxOutputTokens: 16_000 },
      AnalysisSchema,
    )

    return { analysis: verifyAnalysis(data, clauses), trace }
  },
})
