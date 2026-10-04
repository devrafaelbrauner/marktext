export interface SectionCount {
  title: string
  words: number
}

const wordsIn = (line: string): number => {
  const trimmed = line.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/** Words per heading. A leading untitled span is omitted when it is empty. */
export const countSections = (markdown: string, countCode = true): SectionCount[] => {
  const source = countCode ? markdown : markdown.replace(/```[\s\S]*?```/g, ' ')
  const sections: SectionCount[] = []
  let current: SectionCount = { title: 'Intro', words: 0 }
  for (const line of source.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      sections.push(current)
      current = { title: heading[2], words: 0 }
    } else {
      current.words += wordsIn(line)
    }
  }
  sections.push(current)
  return sections.filter((section) => section.title !== 'Intro' || section.words > 0)
}

export const totalWords = (sections: readonly SectionCount[]): number =>
  sections.reduce((sum, section) => sum + section.words, 0)
