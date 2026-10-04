export interface ICodeBlockRenderContext {
    /** Code block content, without fences. */
    source: string;
    /** First word of the fence info string, lower-cased. */
    lang: string;
    /** Aborted when a newer render supersedes this one or the block goes away. */
    signal: AbortSignal;
    /** Replaces the code block content as one undoable edit (a new render follows). */
    setSource: (next: string) => void;
}

/**
 * Live preview below fenced code blocks of the given languages. The block
 * stays a plain code block, so the markdown round-trips unchanged.
 */
export interface ICodeBlockRenderer {
    /** Lower-case fence languages; never a built-in diagram language. */
    lang: string[];
    /**
     * Renders into `container` (emptied before each call). The returned
     * cleanup runs before the next render and when the preview goes away.
     */
    render: (
        container: HTMLElement,
        ctx: ICodeBlockRenderContext,
    ) => void | (() => void) | Promise<void | (() => void)>;
    /** Delay after the last edit before re-rendering, in ms. Default 300. */
    debounceMs?: number;
    /** Static HTML for export; without it the block exports as code. */
    exportHtml?: (source: string, lang: string) => string | Promise<string>;
}

// Languages the engine itself turns into `diagram`/`math` blocks.
const RESERVED_LANGS: ReadonlySet<string> = new Set([
    'mermaid',
    'plantuml',
    'vega-lite',
    'flowchart',
    'sequence',
    'math',
]);

const renderers = new Map<string, ICodeBlockRenderer>();
const listeners = new Set<() => void>();

function notify() {
    for (const listener of listeners)
        listener();
}

/**
 * Registers `renderer` for every editor; open editors attach previews
 * immediately. Returns the unregister function.
 */
export function registerCodeBlockRenderer(renderer: ICodeBlockRenderer): () => void {
    if (!Array.isArray(renderer.lang) || renderer.lang.length === 0)
        throw new Error('A code block renderer needs at least one language.');

    for (const lang of renderer.lang) {
        if (!/^\S+$/.test(lang) || lang !== lang.toLowerCase())
            throw new Error(`Invalid code block renderer language "${lang}".`);
        if (RESERVED_LANGS.has(lang))
            throw new Error(`"${lang}" is a built-in diagram language.`);
        if (renderers.has(lang))
            throw new Error(`A code block renderer for "${lang}" is already registered.`);
    }

    for (const lang of renderer.lang)
        renderers.set(lang, renderer);
    notify();

    return () => {
        let changed = false;
        for (const lang of renderer.lang) {
            if (renderers.get(lang) === renderer) {
                renderers.delete(lang);
                changed = true;
            }
        }
        if (changed)
            notify();
    };
}

export function getCodeBlockRenderer(lang: string): ICodeBlockRenderer | undefined {
    return renderers.get(lang);
}

export function hasCodeBlockRenderers() {
    return renderers.size > 0;
}

/** Called after every register/unregister; returns the unsubscribe function. */
export function onCodeBlockRenderersChange(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
