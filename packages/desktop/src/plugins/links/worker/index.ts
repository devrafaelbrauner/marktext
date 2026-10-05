import { registerWorkerHandler } from '../../../main/vaultIndex/worker/handlers'
import { findMentions } from '../common/mentions'
import { MAX_UNLINKED_MENTIONS, type UnlinkedMentionsRequest, type UnlinkedMentionsResult } from '../common/protocol'

const MAX_NOTE_BYTES = 2 * 1024 * 1024

const isRequest = (payload: unknown): payload is UnlinkedMentionsRequest =>
  typeof payload === 'object' &&
  payload !== null &&
  'path' in payload &&
  typeof payload.path === 'string' &&
  (!('limit' in payload) || payload.limit === undefined || typeof payload.limit === 'number')

/**
 * Notes that mention the basename or an alias of `path` as plain text but do
 * not link to it. Reads the notes from disk, so it lives in the index worker.
 */
registerWorkerHandler('links.unlinkedMentions', async(payload, { index, fs }): Promise<UnlinkedMentionsResult> => {
  if (!isRequest(payload)) throw new Error('links.unlinkedMentions expects { path }')
  const target = index.getFile(payload.path)
  if (!target) return { files: [], truncated: false }
  const terms = [target.basename, ...target.aliases]
  const limit = Math.min(payload.limit ?? MAX_UNLINKED_MENTIONS, MAX_UNLINKED_MENTIONS)
  const result: UnlinkedMentionsResult = { files: [], truncated: false }
  let total = 0

  for (const note of index.listFiles()) {
    if (note.path === target.path || note.size > MAX_NOTE_BYTES) continue
    if (note.links.some((link) => link.resolved === target.path)) continue
    let content: string
    let mtimeMs: number
    try {
      const [text, stat] = await Promise.all([fs.readText(note.path), fs.stat(note.path)])
      if (!stat) continue
      content = text
      mtimeMs = stat.mtimeMs
    } catch {
      continue
    }
    const mentions = findMentions(content, terms, limit - total + 1)
    if (!mentions.length) continue
    if (total + mentions.length > limit) {
      result.files.push({ sourcePath: note.path, mtimeMs, mentions: mentions.slice(0, limit - total) })
      result.truncated = true
      break
    }
    total += mentions.length
    result.files.push({ sourcePath: note.path, mtimeMs, mentions })
  }
  return result
})
