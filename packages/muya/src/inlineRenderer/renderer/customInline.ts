import type { CustomInlineToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';

// Attribute carrying the rule name, read back by the Ctrl/Cmd-click handler.
export const CUSTOM_INLINE_NAME_ATTR = 'data-mu-inline-syntax';

// Token from `registerInlineSyntax`: `span.mu-inline-<name>` wrapping
// [marker][content][marker]. Markers hide like link brackets unless the caret
// is inside the token, so the text content always equals the source.
export default function customInline(
    this: Renderer,
    {
        h,
        cursor,
        block,
        token,
        outerClass,
    }: ISyntaxRenderOptions & { token: CustomInlineToken },
) {
    const className = this.getClassName(outerClass, block, token, cursor);
    const { start, end } = token.range;
    const { contentStart, contentEnd } = token;
    const children = [];

    if (contentStart > start) {
        children.push(h(
            `span.${className}.${CLASS_NAMES.MU_REMOVE}`,
            this.highlight(h, block, start, contentStart, token),
        ));
    }
    children.push(h(
        `span.${CLASS_NAMES.MU_INLINE_RULE}`,
        this.highlight(h, block, contentStart, contentEnd, token),
    ));
    if (end > contentEnd) {
        children.push(h(
            `span.${className}.${CLASS_NAMES.MU_REMOVE}`,
            this.highlight(h, block, contentEnd, end, token),
        ));
    }

    const attrs: Record<string, string> = { [CUSTOM_INLINE_NAME_ATTR]: token.name };
    if (token.noSpellcheck)
        attrs.spellcheck = 'false';

    return [
        h(
            `span.mu-inline-${token.name}`,
            { attrs, dataset: token.data },
            children,
        ),
    ];
}
