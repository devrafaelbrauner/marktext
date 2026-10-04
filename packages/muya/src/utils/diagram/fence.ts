import type { IDiagramMeta, IDiagramState } from '../../state/types';

const DIAGRAM_TYPES = ['mermaid', 'plantuml', 'vega-lite', 'flowchart', 'sequence'] as const;

/**
 * The diagram type a fence language renders as, or null for a code language.
 * @param lang the first word of the fence info string
 */
export function diagramTypeOfLang(lang: string): IDiagramMeta['type'] | null {
    return DIAGRAM_TYPES.find(type => type === lang) ?? null;
}

export interface IDiagramFence {
    fenceChar?: '`' | '~';
    fenceLength?: number;
    info?: string;
}

export function createDiagramState(type: IDiagramMeta['type'], text = '', fence: IDiagramFence = {}): IDiagramState {
    const meta: IDiagramMeta = { type, lang: type === 'vega-lite' ? 'json' : 'yaml' };
    if (fence.fenceChar === '~')
        meta.fenceChar = '~';
    if (fence.fenceLength && fence.fenceLength > 3)
        meta.fenceLength = fence.fenceLength;
    if (fence.info && fence.info !== type)
        meta.info = fence.info;

    return { name: 'diagram', text, meta };
}
