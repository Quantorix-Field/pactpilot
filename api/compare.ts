import { generateJson } from './_lib/gemini.js'
import { BODY_LIMITS, createHandler } from './_lib/guard.js'
import { buildComparePrompt } from './_lib/prompts.js'
import { CompareRequestSchema, CompareSchema } from './_lib/schemas.js'
import { verifyCompare } from './_lib/verify.js'

export default createHandler({
  schema: CompareRequestSchema,
  maxBytes: BODY_LIMITS.text,
  run: async ({ a, b, perspective, language }) => {
    const { system, user } = buildComparePrompt({ a, b, perspective, language })

    const { data, trace } = await generateJson(
      { system, user, maxOutputTokens: 16_000 },
      CompareSchema,
    )

    return { result: verifyCompare(data, a.clauses, b.clauses), trace }
  },
})
