import type { MentionMatch } from './mentions'

/** Upper bound of mentions one `links.unlinkedMentions` request returns. */
export const MAX_UNLINKED_MENTIONS = 200

export interface UnlinkedMentionsRequest {
  /** Absolute path of the note whose mentions are wanted. */
  path: string
  limit?: number
}

export interface UnlinkedMentionsResult {
  files: Array<{
    /** Absolute path of the mentioning note. */
    sourcePath: string
    /** Modification time read with the content; passed back as `expectedMtimeMs` when linking. */
    mtimeMs: number
    mentions: MentionMatch[]
  }>
  /** True when the cap cut the result short. */
  truncated: boolean
}
