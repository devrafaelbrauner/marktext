import type { Muya } from '../muya';
import type { ICodeBlockRenderer } from './registry';
import logger from '../utils/logger';
import './index.css';

const debug = logger('codeBlockPreview:');

const DEFAULT_DEBOUNCE_MS = 300;

// Events that must not reach the editor: an interactive widget inside the
// preview would otherwise move the caret or edit the document.
const ISOLATED_EVENTS = [
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'pointerdown',
    'pointerup',
    'touchstart',
    'touchend',
    'keydown',
    'keyup',
    'keypress',
    'beforeinput',
    'input',
    'compositionstart',
    'compositionend',
    'paste',
    'cut',
    'copy',
    'dragstart',
    'drop',
];

export interface ICodeBlockPreviewHost {
    muya: Muya;
    domNode: HTMLElement;
    getSource: () => string;
    setSource: (next: string) => void;
}

const livePreviews = new WeakMap<Muya, { previews: Set<CodeBlockPreview>; observer: MutationObserver }>();

// Removal of a code block (or any ancestor) only detaches DOM, so a mutation
// observer on the editor root disposes previews whose block left the tree.
function track(preview: CodeBlockPreview) {
    const { muya } = preview.host;
    let entry = livePreviews.get(muya);
    if (!entry) {
        const previews = new Set<CodeBlockPreview>();
        const observer = new MutationObserver(() => {
            for (const p of [...previews]) {
                if (!p.isInEditor())
                    p.destroy();
            }
        });
        observer.observe(muya.domNode, { childList: true, subtree: true });
        entry = { previews, observer };
        livePreviews.set(muya, entry);
    }
    entry.previews.add(preview);
}

function untrack(preview: CodeBlockPreview) {
    const { muya } = preview.host;
    const entry = livePreviews.get(muya);
    if (!entry)
        return;
    entry.previews.delete(preview);
    if (entry.previews.size === 0) {
        entry.observer.disconnect();
        livePreviews.delete(muya);
    }
}

/** Disposes every preview of `muya` (editor destroy). */
export function destroyCodeBlockPreviews(muya: Muya) {
    const entry = livePreviews.get(muya);
    if (!entry)
        return;
    for (const preview of [...entry.previews])
        preview.destroy();
}

/**
 * The preview of one fenced code block for one renderer/lang pair; replaced
 * (not mutated) when either changes.
 */
export class CodeBlockPreview {
    public readonly domNode: HTMLElement;
    private _timer: number | undefined;
    private _controller: AbortController | null = null;
    private _cleanup: (() => void) | null = null;
    private _renderedSource: string | null = null;
    private _destroyed = false;

    constructor(
        public readonly host: ICodeBlockPreviewHost,
        public readonly renderer: ICodeBlockRenderer,
        public readonly lang: string,
    ) {
        const domNode = document.createElement('div');
        domNode.className = 'mu-code-block-preview';
        domNode.setAttribute('contenteditable', 'false');
        domNode.dataset.lang = lang;
        for (const type of ISOLATED_EVENTS)
            domNode.addEventListener(type, event => event.stopPropagation());
        this.domNode = domNode;
        host.domNode.appendChild(domNode);
        track(this);
        this.render();
    }

    isInEditor() {
        return this.host.muya.domNode.contains(this.host.domNode);
    }

    /** Re-renders after the debounce delay when the source changed. */
    update() {
        if (this._destroyed || this.host.getSource() === this._renderedSource)
            return;
        window.clearTimeout(this._timer);
        this._timer = window.setTimeout(() => {
            this._timer = undefined;
            this.render();
        }, this.renderer.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    }

    render() {
        if (this._destroyed)
            return;
        window.clearTimeout(this._timer);
        this._dispose();

        const source = this.host.getSource();
        const controller = new AbortController();
        const { signal } = controller;
        this._controller = controller;
        this._renderedSource = source;
        this.domNode.replaceChildren();

        const accept = (cleanup: void | (() => void)) => {
            if (typeof cleanup !== 'function')
                return;
            if (signal.aborted)
                cleanup();
            else
                this._cleanup = cleanup;
        };
        const fail = (error: unknown) => {
            if (signal.aborted)
                return;
            debug.warn(String(error));
            const message = document.createElement('div');
            message.className = 'mu-code-block-preview-error';
            // textContent: the message can never inject markup.
            message.textContent = error instanceof Error ? error.message : String(error);
            this.domNode.replaceChildren(message);
        };

        try {
            const result = this.renderer.render(this.domNode, {
                source,
                lang: this.lang,
                signal,
                setSource: (next: string) => {
                    if (!signal.aborted)
                        this.host.setSource(next);
                },
            });
            if (result instanceof Promise)
                result.then(accept, fail);
            else
                accept(result);
        }
        catch (error) {
            fail(error);
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        window.clearTimeout(this._timer);
        this._dispose();
        this.domNode.remove();
        untrack(this);
    }

    // Aborts the in-flight render and runs the previous cleanup.
    private _dispose() {
        this._controller?.abort();
        this._controller = null;
        const cleanup = this._cleanup;
        this._cleanup = null;
        if (cleanup) {
            try {
                cleanup();
            }
            catch (error) {
                debug.warn(String(error));
            }
        }
    }
}
