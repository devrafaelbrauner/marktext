import type { VNode } from 'snabbdom';
import type { CodeEmojiMathToken, ISyntaxRenderOptions } from '../types';
import type Renderer from './index';
import { CLASS_NAMES } from '../../config';
import { validEmoji } from '../../utils/emoji';
import { highlightsIn, wrapDecorations } from './highlight';

// render token of emoji to vnode
export default function emoji(
    this: Renderer,
    { h, cursor, block, token, outerClass }: ISyntaxRenderOptions & { token: CodeEmojiMathToken },
) {
    const { start: rStart, end: rEnd } = token.range;
    const className = this.getClassName(outerClass, block, token, cursor);
    const validation = validEmoji(token.content);
    const finalClass = validation ? className : CLASS_NAMES.MU_WARN;
    const contentSelector
        = finalClass !== CLASS_NAMES.MU_GRAY
            ? `span.${finalClass}.${CLASS_NAMES.MU_INLINE_RULE}.${CLASS_NAMES.MU_EMOJI_MARKED_TEXT}`
            : `span.${CLASS_NAMES.MU_INLINE_RULE}.${CLASS_NAMES.MU_EMOJI_MARKED_TEXT}`;

    const markerSelector = `span.${finalClass}.${CLASS_NAMES.MU_EMOJI_MARKER}`;
    const markerLen = token.marker.length;
    // A search match over a marker colours the marker span itself; decorations
    // wrap the marker text.
    const marker = (mStart: number, mEnd: number) => {
        let selector = markerSelector;
        let child: VNode | string = token.marker;
        for (const light of highlightsIn(token, mStart, mEnd)) {
            if (!light.decorationOnly)
                selector += `.${this.getHighlightClassName(!!light.active)}`;
            if (light.decorations)
                child = wrapDecorations(h, light.decorations, token.marker);
        }

        return h(selector, [child]);
    };
    const content: string | (VNode | string)[] = token.highlights && token.highlights.length
        ? this.highlight(h, block, rStart + markerLen, rEnd - markerLen, token)
        : token.content;

    const emojiVNode = validation
        ? h(
                contentSelector,
                {
                    attrs: {
                        spellcheck: 'false',
                    },
                    dataset: {
                        emoji: validation.emoji,
                    },
                },
                content,
            )
        : h(contentSelector, content);

    return [
        marker(rStart, rStart + markerLen),
        emojiVNode,
        marker(rEnd - markerLen, rEnd),
    ];
}
