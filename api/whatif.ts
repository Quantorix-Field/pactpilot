import { generateJson } from './_lib/gemini.js'
import { BODY_LIMITS, createHandler } from './_lib/guard.js'
import { buildWhatIfPrompt } from './_lib/prompts.js'
import { WhatIfRequestSchema, WhatIfSchema } from './_lib/schemas.js'
import { verifyWhatIf } from './_lib/verify.js'

export default createHandler({
  schema: WhatIfRequestSchema,
  maxBytes: BODY_LIMITS.text,
  run: async ({ clauses, perspective, scenario, language }) => {
    const { system, user } = buildWhatIfPrompt({ clauses, perspective, scenario, language })

    const { data, trace } = await generateJson(
      { system, user, temperature: 0.3, maxOutputTokens: 12_000 },
      WhatIfSchema,
    )

    return { result: verifyWhatIf(data, clauses), trace }
  },
})
