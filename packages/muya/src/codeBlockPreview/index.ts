import type CodeBlock from '../block/commonMark/codeBlock';
import type { Muya } from '../muya';
import { BLOCK_DOM_PROPERTY } from '../config';

export { destroyCodeBlockPreviews } from './preview';
export { getCodeBlockRenderer, hasCodeBlockRenderers, onCodeBlockRenderersChange, registerCodeBlockRenderer } from './registry';
export type { ICodeBlockRenderContext, ICodeBlockRenderer } from './registry';

/** Re-evaluates the preview of every code block of `muya` against the registry. */
export function refreshCodeBlockPreviews(muya: Muya) {
    const nodes = muya.domNode.querySelectorAll<HTMLElement>('pre.mu-code-block');
    for (const node of nodes) {
        const block = (node as HTMLElement & { [BLOCK_DOM_PROPERTY]?: CodeBlock })[BLOCK_DOM_PROPERTY];
        if (block?.blockName === 'code-block')
            block.syncPreview();
    }
}
