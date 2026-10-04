import type { TCodeBlockExports } from '../../codeBlockPreview/export';
import type { ILexOption } from './types';
import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import Prism from 'prismjs';
import { codeBlockExportExtension } from '../../codeBlockPreview/export';
import { hasCodeBlockRenderers } from '../../codeBlockPreview/registry';
import { customInlineMarkedExtension, hasInlineSyntaxRules } from '../../inlineRenderer/customSyntax';
import cjkEmStrongExtension from './extensions/cjkEmStrong';
import emojiExtension from './extensions/emoji';
import footnoteExtension from './extensions/footnote';
import mathExtension, { doubleBackslashMathExtension, gfmMathExtension, singleBackslashMathExtension } from './extensions/math';
import superSubScriptExtension from './extensions/superSubscript';
import fm, { frontMatterRender } from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

const DIAGRAM_TYPE = [
    'mermaid',
    'plantuml',
    'vega-lite',
    'flowchart',
    'sequence',
];

function highlight(code: string, lang: string) {
    // Language may be undefined (GH#591)
    if (!lang)
        return code;

    if (DIAGRAM_TYPE.includes(lang))
        return code;

    const grammar = Prism.languages[lang];
    if (!grammar) {
        console.warn(`Unable to find grammar for "${lang}".`);
        return code;
    }
    return Prism.highlight(code, grammar, lang);
}

// `codeBlockExports`: awaited `exportHtml` results of registered code block
// renderers (see `resolveCodeBlockExports`); without them only synchronous
// exporters apply.
export function getHighlightHtml(src: string, options: ILexOption = {}, codeBlockExports?: TCodeBlockExports) {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { footnote, frontMatter, texMathDollars, texMathGfm, texMathSingleBackslash, texMathDoubleBackslash, superSubScript }
        = options;

    // Build a fresh Marked instance per call. `Marked.use({ walkTokens })`
    // chains rather than replaces, so reusing a module-level singleton would
    // cause walkTokens to fire N times after N invocations and corrupt token
    // state (e.g. wiping `lang` on subsequent runs).
    const marked = new Marked(markedHighlight({ highlight }));

    marked.use({
        walkTokens: walkTokens({ texMathDollars, texMathGfm }),
    });

    // Treat CJK characters as punctuation for emphasis/strong flanking so
    // `中文**"加粗"**中文` bolds (marktext/marktext#4307). Additive override —
    // never regresses spec-conformant Latin emphasis.
    marked.use(cjkEmStrongExtension());

    marked.use(emojiExtension({ isRenderEmoji: true }));

    if (texMathDollars) {
        marked.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathGfm) {
        marked.use(
            gfmMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathSingleBackslash) {
        marked.use(
            singleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (texMathDoubleBackslash) {
        marked.use(
            doubleBackslashMathExtension({
                throwOnError: false,
                useKatexRender: true,
            }),
        );
    }

    if (superSubScript)
        marked.use(superSubScriptExtension());

    if (footnote)
        marked.use(footnoteExtension());

    // Opt-in: with nothing registered the output is exactly marked's.
    if (hasCodeBlockRenderers())
        marked.use(codeBlockExportExtension(codeBlockExports));

    if (hasInlineSyntaxRules())
        marked.use(customInlineMarkedExtension());

    let html = '';

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            src = newSrc;
        }
    }

    html += marked.parse(src);

    return html;
}
