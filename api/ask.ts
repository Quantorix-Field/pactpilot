import { generateJson } from './_lib/gemini.js'
import { BODY_LIMITS, createHandler } from './_lib/guard.js'
import { buildAskPrompt } from './_lib/prompts.js'
import { AskRequestSchema, AskSchema } from './_lib/schemas.js'
import { verifyAsk } from './_lib/verify.js'

export default createHandler({
  schema: AskRequestSchema,
  maxBytes: BODY_LIMITS.text,
  run: async ({ clauses, perspective, question, language }) => {
    const { system, user } = buildAskPrompt({ clauses, perspective, question, language })

    const { data, trace } = await generateJson(
      { system, user, temperature: 0.1, maxOutputTokens: 8_000 },
      AskSchema,
    )

    return { result: verifyAsk(data, clauses), trace }
  },
})
