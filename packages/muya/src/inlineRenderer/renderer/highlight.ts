import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { H, IHighlight, IHighlightDecoration, Token } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';
import { union } from '../../utils';

const CLASS_TOKEN_REG = /^[\w-]+$/;
const DATA_KEY_REG = /^[\w-]+$/;

function decorationVNode(h: H, decoration: IHighlightDecoration, children: (VNode | string)[]) {
    const classes: Record<string, boolean> = { [CLASS_NAMES.MU_DECORATION]: true };
    for (const name of decoration.className.split(/\s+/)) {
        if (CLASS_TOKEN_REG.test(name))
            classes[name] = true;
    }

    const attrs: Record<string, string> = {};
    if (decoration.data) {
        for (const [key, value] of Object.entries(decoration.data)) {
            if (DATA_KEY_REG.test(key))
                attrs[`data-${key}`] = String(value);
        }
    }
    // Written last so `range.data` cannot spoof the keys the click handler reads.
    attrs['data-mu-decoration-layer'] = decoration.layerId;
    attrs['data-mu-decoration-index'] = String(decoration.index);

    return h('span', { class: classes, attrs }, children);
}

/**
 * Wraps `text` in one span per decoration, outermost first. The spans hold
 * only `text`, so the rendered textContent still equals the source.
 */
export function wrapDecorations(h: H, decorations: IHighlightDecoration[] | undefined, text: string): VNode | string {
    let node: VNode | string = text;
    if (decorations) {
        for (let i = decorations.length - 1; i >= 0; i--)
            node = decorationVNode(h, decorations[i], [node]);
    }

    return node;
}

// Overlaps of the token's highlights with `[rStart, rEnd)`. The highlights are
// sorted and disjoint (merged in `InlineRenderer.patch`), so the result is too.
export function highlightsIn(token: Token, rStart: number, rEnd: number): IHighlight[] {
    const result: IHighlight[] = [];
    if (token.highlights) {
        for (const light of token.highlights) {
            const un = union({ start: rStart, end: rEnd }, light);
            if (un)
                result.push(un);
        }
    }

    return result;
}

// change text to highlight vnode
export default function highlight(
    this: Renderer,
    h: H,
    block: Format,
    rStart: number,
    rEnd: number,
    token: Token,
) {
    const { text } = block;
    const unions = highlightsIn(token, rStart, rEnd);

    if (!unions.length)
        return [text.substring(rStart, rEnd)];

    const result: (VNode | string)[] = [];
    let pos = rStart;

    for (const u of unions) {
        const { start, end, active } = u;

        if (pos < start)
            result.push(text.substring(pos, start));

        const painted = wrapDecorations(h, u.decorations, text.substring(start, end));
        result.push(
            u.decorationOnly
                ? painted
                : h(`span.${this.getHighlightClassName(!!active)}`, [painted]),
        );
        pos = end;
    }

    if (pos < rEnd)
        result.push(text.substring(pos, rEnd));

    return result;
}
