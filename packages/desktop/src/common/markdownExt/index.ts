/**
 * Pure parsers for the Obsidian-style markdown extensions (wikilinks, tags,
 * front matter, inline fields, tasks). No DOM, Node or Electron: they run in
 * the vault index worker and in renderer-side editor extensions alike.
 */
export { MARKDOWN_FILE_EXTENSIONS, getLinkExtension, isMarkdownExtension, isNoteTarget } from './extensions'
export {
  extractFrontMatter,
  getFrontMatterAliases,
  getFrontMatterTags,
  parseFrontMatter,
  parseYamlObject,
  type FrontMatterBlock
} from './frontMatter'
export {
  addInlineField,
  findBracketFields,
  matchLineField,
  normalizeFieldKey,
  parseInlineFieldValue,
  type InlineFieldMatch,
  type InlineFieldValue
} from './inlineFields'
export { lineOfOffset, maskDocument, type MaskedDocument } from './mask'
export { findMarkdownLinks, parseLinkDestination, type LinkDestination, type MarkdownLinkMatch } from './markdownLinks'
export { parseNote, type NoteMetadata, type ParsedLink } from './parseNote'
export { createLinkResolver, resolveLinkTarget, type LinkResolver } from './resolve'
export { findTags, isHexColour, isTagBoundary, matchTag, normalizeTag, type TagMatch } from './tags'
export { countWords, getDailyNoteDate, toPlainText } from './text'
export { matchWikilink, parseWikilink, parseWikilinkContent, WIKILINK_SOURCE, type ParsedWikilink } from './wikilinks'
