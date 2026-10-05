import type { AiAction } from '../common/types'
import type { ChatMessage } from './client'

const NO_FENCES = 'Do not wrap the reply in code fences.'

const SYSTEM_PROMPTS: Record<AiAction, string> = {
  fixText: [
    'You are a proofreader. Correct spelling, grammar, punctuation and agreement errors in the text the user sends.',
    'Keep its language (never translate), meaning, tone and wording otherwise unchanged.',
    'Keep the Markdown syntax, line breaks, links, inline code and math exactly as they are.',
    'Reply with the corrected text only: no explanations, no notes, no quotation marks around it.',
    'If nothing needs fixing, reply with the text unchanged.',
    NO_FENCES
  ].join(' '),
  createTable: [
    'Turn the instruction or data the user sends into one GitHub Flavored Markdown table.',
    'Reply with the table only (header row, delimiter row, body rows), with no text before or after it.',
    'Write the cells in the language of the user\'s text.',
    NO_FENCES
  ].join(' '),
  solveMath: [
    'Solve the math expression or problem the user sends.',
    'Reply in Markdown, concisely: give the result first; add short step-by-step working only when the problem needs several steps.',
    'Write formulas as inline math between single dollar signs when that helps.',
    'Answer in the language of the user\'s text.',
    NO_FENCES
  ].join(' '),
  research: [
    'Answer the user\'s question concisely in Markdown (short paragraphs or lists).',
    'Say clearly when you are unsure or when the information may be outdated.',
    'When you relied on sources, list them at the end as Markdown links.',
    'Answer in the language of the question.',
    NO_FENCES
  ].join(' ')
}

/** Language codes accepted as a hint (`pt`, `en`, `zh-CN`, …); anything else is ignored. */
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/

/**
 * Chat messages for `action` on `text`: the action's system prompt and the
 * text as the user message, verbatim. `language` (UI language code) only
 * breaks ties when the text's own language is unclear.
 */
export const buildMessages = (action: AiAction, text: string, language?: string): ChatMessage[] => {
  const hint =
    language && LANGUAGE_PATTERN.test(language)
      ? ` If the language of the user's text is unclear, use the language with code "${language}".`
      : ''
  return [
    { role: 'system', content: SYSTEM_PROMPTS[action] + hint },
    { role: 'user', content: text }
  ]
}

/** Actions whose reply replaces or becomes literal document text, so a code block around all of it is never wanted. */
const RAW_TEXT_ACTIONS: Record<AiAction, boolean> = {
  fixText: true,
  createTable: true,
  solveMath: false,
  research: false
}

/** A reply that is one fenced code block: ``` or ~~~ fence, optional info string, body, closing fence. */
const WRAPPING_FENCE = /^(`{3,}|~{3,})[^\n`]*\n([\s\S]*?)\n?\1\s*$/

/**
 * Trims `reply` and, for actions that expect raw text, unwraps it when the
 * model put all of it in a fenced code block despite the prompt.
 */
export const cleanReply = (action: AiAction, reply: string): string => {
  const trimmed = reply.trim()
  if (!RAW_TEXT_ACTIONS[action]) return trimmed
  const fenced = WRAPPING_FENCE.exec(trimmed)
  return fenced ? fenced[2].trim() : trimmed
}
