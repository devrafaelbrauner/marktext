import {
  basenameOf,
  dailyNoteRelativePath,
  isDateKey,
  keyToDate,
  normalizeFolder,
  parseDate,
  relativeToRoot,
  type DailyNoteLocation,
  type DateKey
} from './dates'

/** The subset of `FileMetadata` the calendar needs (answer of the `daily-notes.notes` worker request). */
export interface NoteFileInfo {
  /** Absolute path. */
  path: string
  /** `YYYY-MM-DD` when the vault index saw a date-shaped basename. */
  day: string | null
  wordCount: number
}

/** Answer of the `daily-notes.notes` worker request. */
export interface NotesResponse {
  rootPath: string
  notes: NoteFileInfo[]
}

export interface DailyNote {
  date: DateKey
  /** Absolute path. */
  path: string
  wordCount: number
}

interface Candidate extends DailyNote {
  /** Lower wins when several files claim the same day. */
  rank: number
}

/**
 * Previous (`direction` -1) or next (+1) date of `sortedDates` strictly
 * before/after `current`; `current` itself need not be in the list.
 */
export const findAdjacentDate = (sortedDates: readonly DateKey[], current: DateKey, direction: -1 | 1): DateKey | null => {
  // First index whose date is > current (direction 1) or >= current (direction -1).
  let low = 0
  let high = sortedDates.length
  while (low < high) {
    const mid = (low + high) >> 1
    const before = direction === 1 ? sortedDates[mid] <= current : sortedDates[mid] < current
    if (before) low = mid + 1
    else high = mid
  }
  if (direction === 1) return low < sortedDates.length ? sortedDates[low] : null
  return low > 0 ? sortedDates[low - 1] : null
}

/**
 * Daily notes of a vault for one folder/format setting. A file is a daily
 * note of day D when its path (inside the daily folder, for formats with `/`)
 * or its basename reads as D with the format, or when the vault index gave it
 * the date-shaped `day`. When several files claim D, the one at the exact
 * configured path wins, then files inside the daily folder, then format
 * matches over `day`-only matches, then the alphabetically first path.
 */
export class DailyNoteIndex {
  private readonly byDate = new Map<DateKey, DailyNote>()
  private readonly byPath = new Map<string, DailyNote>()
  /** Every file by its `/`-separated vault-relative path, for exact-path lookups. */
  private readonly files = new Map<string, NoteFileInfo>()
  private readonly folder: string
  readonly sortedDates: readonly DateKey[]

  constructor(
    private readonly root: string,
    private readonly location: DailyNoteLocation,
    notes: readonly NoteFileInfo[]
  ) {
    this.folder = normalizeFolder(location.folder)
    const winners = new Map<DateKey, Candidate>()
    for (const note of notes) {
      const relative = relativeToRoot(root, note.path)
      if (!relative) continue
      this.files.set(relative, note)
      const parsed = this.parseRelative(relative)
      const date = parsed ?? (note.day && isDateKey(note.day) ? note.day : null)
      if (!date) continue
      const exact = parsed !== null && dailyNoteRelativePath(keyToDate(parsed), location) === relative
      const inFolder = !this.folder || relative.startsWith(this.folder + '/')
      const rank = exact ? 0 : (inFolder ? 1 : 3) + (parsed ? 0 : 1)
      this.byPath.set(relative, { date, path: note.path, wordCount: note.wordCount })
      const current = winners.get(date)
      if (!current || rank < current.rank || (rank === current.rank && note.path < current.path)) {
        winners.set(date, { date, path: note.path, wordCount: note.wordCount, rank })
      }
    }
    for (const { date, path, wordCount } of winners.values()) this.byDate.set(date, { date, path, wordCount })
    this.sortedDates = [...this.byDate.keys()].sort()
  }

  /**
   * Date the configured format reads from a vault-relative path: the path
   * inside the daily folder for formats with `/`, else the basename.
   */
  private parseRelative(relative: string): DateKey | null {
    let subject = basenameOf(relative)
    if (this.location.format.includes('/')) {
      if (this.folder && !relative.startsWith(this.folder + '/')) return null
      subject = (this.folder ? relative.slice(this.folder.length + 1) : relative).replace(/\.[^./]+$/, '')
    }
    return parseDate(subject, this.location.format, this.location.locale)
  }

  /**
   * Daily note of `date`. Falls back to the file at the configured path, which
   * also finds notes whose format cannot be read back (e.g. week numbers).
   */
  get(date: DateKey): DailyNote | null {
    const known = this.byDate.get(date)
    if (known) return known
    const relative = dailyNoteRelativePath(keyToDate(date), this.location)
    const file = relative ? this.files.get(relative) : undefined
    return file ? { date, path: file.path, wordCount: file.wordCount } : null
  }

  /**
   * Date of the daily note at absolute `path`, or null when it is not one.
   * A file the index has not seen yet (a note created a moment ago) is judged
   * by its path alone.
   */
  dateOf(path: string): DateKey | null {
    const relative = relativeToRoot(this.root, path)
    if (!relative) return null
    const known = this.byPath.get(relative)
    if (known) return known.date
    if (this.files.has(relative)) return null
    const basename = basenameOf(relative)
    return this.parseRelative(relative) ?? (isDateKey(basename) ? basename : null)
  }

  /** The nearest existing daily note before (-1) or after (+1) `date`. */
  adjacent(date: DateKey, direction: -1 | 1): DailyNote | null {
    const target = findAdjacentDate(this.sortedDates, date, direction)
    return target ? (this.byDate.get(target) ?? null) : null
  }
}
