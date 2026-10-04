import type { TBlockPath } from '../block/types';
import type { Labels, Token } from '../inlineRenderer/types';
import type { Muya } from '../muya';
import type { TState } from '../state/types';
import escapeCharactersMap from '../config/escapeCharacter';

/**
 * Prose (`text`) or syntax to skip (`markup`), optionally read as
 * `interpretAs` — the shape of LanguageTool's `data.annotation` elements.
 */
export type TAnnotationPart = { text: string } | { markup: string; interpretAs?: string };

/**
 * One proofreadable block. Joining the `text`/`markup` values of
 * `annotation` in order reproduces `text` exactly, so offsets into the joined
 * string are offsets into `text`.
 */
export interface ICheckableBlock {
    path: TBlockPath;
    /** 'paragraph.content', 'atxheading.content', 'setextheading.content' or 'table.cell.content'. */
    blockName: string;
    text: string;
    annotation: TAnnotationPart[];
}

// Read in place of syntax that stands for a word the checker cannot see:
// inline code and math, emoji, images, footnote identifiers, autolinks,
// non-prose HTML and registered custom inline syntax.
const OPAQUE = 'X';

// Syntax that is skipped without standing for anything.
const PLAIN_MARKUP_TOKENS: Readonly<Record<string, true>> = {
    backlash: true,
    header: true,
    tail_header: true,
    hr: true,
    code_fence: true,
    multiple_math: true,
    reference_definition: true,
};

// Inline HTML elements whose content is prose; only their tags are markup.
// Any other element is read as one opaque word.
const PROSE_HTML_TAGS: Readonly<Record<string, true>> = {
    a: true,
    abbr: true,
    b: true,
    bdi: true,
    bdo: true,
    big: true,
    cite: true,
    del: true,
    dfn: true,
    em: true,
    font: true,
    i: true,
    ins: true,
    mark: true,
    q: true,
    s: true,
    small: true,
    span: true,
    strike: true,
    strong: true,
    sub: true,
    sup: true,
    u: true,
};

const CHECKABLE_BLOCK_NAMES: Readonly<Record<string, string>> = {
    'paragraph': 'paragraph.content',
    'atx-heading': 'atxheading.content',
    'setext-heading': 'setextheading.content',
    'table.cell': 'table.cell.content',
};

/**
 * Annotation of `text` from its inline tokens (absolute ranges into `text`).
 * Every character lands in exactly one part, in order; characters outside any
 * prose token are markup.
 */
export function buildAnnotation(text: string, tokens: Token[]): TAnnotationPart[] {
    const parts: TAnnotationPart[] = [];
    let pos = 0;

    // Emits `[pos, end)`, joining it with the previous part of the same kind.
    const emit = (end: number, kind: 'text' | 'markup', interpretAs?: string) => {
        const stop = Math.min(end, text.length);
        if (stop <= pos)
            return;

        const value = text.slice(pos, stop);
        pos = stop;
        const last = parts[parts.length - 1];
        if (kind === 'text') {
            if (last && 'text' in last)
                last.text += value;
            else
                parts.push({ text: value });
        }
        else if (interpretAs !== undefined) {
            parts.push({ markup: value, interpretAs });
        }
        else if (last && 'markup' in last && last.interpretAs === undefined) {
            last.markup += value;
        }
        else {
            parts.push({ markup: value });
        }
    };

    function walk(list: Token[]) {
        for (const token of list) {
            emit(token.range.start, 'markup');
            visit(token);
            emit(token.range.end, 'markup');
        }
    }

    function visit(token: Token) {
        const { end } = token.range;

        switch (token.type) {
            case 'text':
                emit(end, 'text');
                return;

            case 'super_sub_script':
                emit(token.range.start + token.marker.length, 'markup');
                emit(end - token.marker.length, 'text');
                return;

            case 'html_tag': {
                const tag = token.tag.toLowerCase();
                if (PROSE_HTML_TAGS[tag] === true)
                    walk(token.children ?? []);
                else
                    emit(end, 'markup', tag === '<!---->' ? undefined : tag === 'br' ? '\n' : OPAQUE);
                return;
            }

            case 'soft_line_break':
                emit(end, 'markup', ' ');
                return;

            case 'hard_line_break':
                emit(end, 'markup', '\n');
                return;

            case 'html_escape':
                emit(end, 'markup', escapeCharactersMap[token.escapeCharacter] ?? token.raw);
                return;
        }

        // strong, em, del, link and reference link: the children carry the prose.
        if ('children' in token)
            walk(token.children);
        else
            emit(end, 'markup', PLAIN_MARKUP_TOKENS[token.type] === true ? undefined : OPAQUE);
    }

    walk(tokens);
    emit(text.length, 'markup');

    return parts;
}

interface ICandidate {
    path: TBlockPath;
    blockName: string;
    text: string;
}

/**
 * Proofreadable blocks of the document in document order, restricted to
 * `paths` when given (unknown or non-checkable paths are skipped). Code, math,
 * HTML, front matter and diagram blocks, thematic breaks and reference
 * definitions are never returned.
 *
 * Reads the json state, so queued edits are flushed first (which emits their
 * `json-change` now instead of on the next frame).
 */
export function getCheckableBlocks(muya: Muya, paths?: TBlockPath[]): ICheckableBlock[] {
    const { jsonState, inlineRenderer } = muya.editor;
    jsonState.flush();

    const wanted = paths ? new Set(paths.map(path => JSON.stringify(path))) : null;
    const labels: Labels = new Map();
    const candidates: ICandidate[] = [];

    // Paths are built while walking: `block.path` costs O(siblings) per block.
    const travel = (states: TState[], prefix: TBlockPath) => {
        states.forEach((state, index) => {
            const path = [...prefix, index];
            if ('children' in state) {
                travel(state.children, [...path, 'children']);
                return;
            }

            // Collected over the whole document, as the renderer does, so
            // reference links tokenize the same way.
            if (state.name === 'paragraph') {
                const { label, info } = inlineRenderer.getLabelInfo(state);
                if (label && info)
                    labels.set(label, info);
            }

            const blockName = CHECKABLE_BLOCK_NAMES[state.name];
            if (typeof blockName !== 'string' || !('text' in state))
                return;

            const textPath = [...path, 'text'];
            if (!wanted || wanted.has(JSON.stringify(textPath)))
                candidates.push({ path: textPath, blockName, text: state.text });
        });
    };
    travel(jsonState.getState(), []);

    const result: ICheckableBlock[] = [];
    for (const { path, blockName, text } of candidates) {
        const tokens = inlineRenderer.tokenize(text, blockName, [], labels);
        if (tokens[0]?.type === 'reference_definition')
            continue;

        result.push({ path, blockName, text, annotation: buildAnnotation(text, tokens) });
    }

    return result;
}
