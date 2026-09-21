import { generateText } from './_lib/gemini.js'
import { BODY_LIMITS, HttpError, createHandler } from './_lib/guard.js'
import { LIMITS } from './_lib/limits.js'
import { NO_TEXT, buildExtractPrompt } from './_lib/prompts.js'
import { ExtractRequestSchema } from './_lib/schemas.js'

const MIN_TEXT_CHARS = 20

/** The first bytes of every real PDF spell "%PDF". A renamed file will not pass. */
function looksLikePdf(base64: string): boolean {
  return Buffer.from(base64.slice(0, 16), 'base64').toString('latin1').startsWith('%PDF')
}

export default createHandler({
  schema: ExtractRequestSchema,
  maxBytes: BODY_LIMITS.pdf,
  run: async ({ mimeType, data }) => {
    if (!looksLikePdf(data)) {
      throw new HttpError(400, 'NOT_A_PDF', 'That file is not a valid PDF.', { field: 'data' })
    }

    const { system, user } = buildExtractPrompt()
    const { data: text, trace } = await generateText({
      system,
      user,
      inlineData: { mimeType, data },
      temperature: 0,
      maxOutputTokens: 20_000,
    })

    if (text === NO_TEXT || text.length < MIN_TEXT_CHARS) {
      throw new HttpError(
        422,
        'NO_TEXT',
        'We could not find readable text in that PDF. Try a clearer copy, or paste the text instead.',
      )
    }
    if (text.length > LIMITS.maxDocChars) {
      throw new HttpError(
        413,
        'TOO_LONG',
        'That document is too long to analyze in one go. Try the key sections, up to about 15 pages.',
      )
    }

    return { text, chars: text.length, trace }
  },
})
