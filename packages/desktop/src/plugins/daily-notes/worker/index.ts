import { registerWorkerHandler } from '../../../main/vaultIndex/worker/handlers'
import { NOTES_REQUEST } from '../common/constants'
import type { NotesResponse } from '../common/noteIndex'

// Only the three fields the calendar reads cross the process boundary, not
// the full metadata (links, tasks, headings) of every note.
registerWorkerHandler(NOTES_REQUEST, (_payload, { index }): NotesResponse => ({
  rootPath: index.rootPath,
  notes: index.listFiles().map((file) => ({ path: file.path, day: file.day, wordCount: file.wordCount }))
}))
