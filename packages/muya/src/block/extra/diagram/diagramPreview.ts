import type { Muya } from '../../../muya';
import type { IDiagramState, TState } from '../../../state/types';
import { fromEvent } from 'rxjs';
import { CLASS_NAMES, PREVIEW_DOMPURIFY_CONFIG } from '../../../config';
import { sanitize } from '../../../utils';
import { finalizeRenderedDiagram, renderDiagram } from '../../../utils/diagram/render';
import logger from '../../../utils/logger';
import Parent from '../../base/parent';

const debug = logger('diagramPreview:');

// Re-render delay while the diagram source is being typed.
export const DIAGRAM_RENDER_DEBOUNCE = 300;

// Obsidian's `class A internal-link;` marks a mermaid node as a link to the
// note named by its label.
const INTERNAL_LINK_SELECTOR = '.internal-link';

class DiagramPreview extends Parent {
    private _code: string;
    private _type: string;
    private _cancelFinalize: (() => void) | null = null;
    // Bumped by every render; an async render whose token is no longer
    // current must not touch the DOM.
    private _generation = 0;
    private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
    static override blockName = 'diagram-preview';

    static create(muya: Muya, state: IDiagramState) {
        const diagramPreview = new DiagramPreview(muya, state);

        return diagramPreview;
    }

    override get path() {
        debug.warn('You can never call `get path` in diagramPreview');
        return [];
    }

    constructor(muya: Muya, { text, meta }: IDiagramState) {
        super(muya);
        this.tagName = 'div';
        this._code = text;
        this._type = meta.type;
        this.classList = ['mu-diagram-preview'];
        this.attributes = {
            spellcheck: 'false',
            contenteditable: 'false',
        };
        this.createDomNode();
        this._attachDOMEvents();
        this.update();
    }

    override getState(): TState {
        debug.warn('You can never call `getState` in diagramPreview');
        return {} as TState;
    }

    private _attachDOMEvents() {
        const clickObservable = fromEvent(this.domNode!, 'click');
        clickObservable.subscribe(this.clickHandler.bind(this));
    }

    clickHandler(event: Event) {
        event.preventDefault();
        event.stopPropagation();

        if (this._type === 'mermaid' && this._emitInternalLinkClick(event))
            return;

        if (this.parent == null)
            return;

        const cursorBlock = this.parent.firstContentInDescendant();
        cursorBlock?.setCursor(0, 0);
    }

    // Cmd/Ctrl-click on an `internal-link` node asks the host to open the
    // note named by the node label. Returns true when the click was one.
    private _emitInternalLinkClick(event: Event): boolean {
        if (!(event instanceof MouseEvent) || !(event.metaKey || event.ctrlKey))
            return false;
        const target = event.target;
        if (!(target instanceof Element))
            return false;
        const node = target.closest(INTERNAL_LINK_SELECTOR);
        if (!node || !this.domNode!.contains(node))
            return false;
        const label = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!label)
            return false;

        this.muya.eventCenter.emit('format-click', {
            event,
            formatType: 'mermaid-internal-link',
            data: { target: label },
        });

        return true;
    }

    // Re-render after the source stopped changing for `DIAGRAM_RENDER_DEBOUNCE` ms.
    scheduleUpdate(code: string) {
        this._code = code;
        if (this._debounceTimer)
            clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            // A removed block only loses its DOM; nothing to render into.
            if (this.domNode!.isConnected)
                void this.update();
        }, DIAGRAM_RENDER_DEBOUNCE);
    }

    async update(code = this._code) {
        const { i18n } = this.muya;
        this._code = code;
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = null;
        }
        const generation = ++this._generation;

        // A previous render may still be waiting for its `<svg>`; it must not
        // describe whatever this one puts in its place.
        this._cancelFinalize?.();
        this._cancelFinalize = null;
        this.domNode!.removeAttribute('role');
        this.domNode!.removeAttribute('aria-label');

        if (code) {
            const { mermaidTheme, mermaidThemeOverride, mermaidLook, vegaTheme, plantumlServer, sequenceTheme } = this.muya.options;
            const { _type: type } = this;
            // Mermaid and vega render asynchronously: draw into an off-screen
            // staging element (attached, so mermaid can measure text) and
            // only adopt the result when no newer render started meanwhile.
            // flowchart.js / js-sequence draw later from a font callback, so
            // they keep drawing in place.
            const staged = type === 'mermaid' || type === 'vega-lite';
            const target = staged ? this._createStaging() : this.domNode!;
            // A staged re-render keeps the previous diagram visible meanwhile.
            if (!staged || !this.domNode!.querySelector('svg, canvas, img'))
                this.domNode!.innerHTML = i18n.t('Loading...');

            try {
                await renderDiagram({
                    target,
                    code,
                    type,
                    mermaidTheme: mermaidThemeOverride || mermaidTheme,
                    mermaidLook,
                    vegaTheme,
                    plantumlServer,
                    sequenceTheme,
                });
                if (generation !== this._generation)
                    return;
                if (staged)
                    this.domNode!.replaceChildren(...target.childNodes);
                if (type === 'mermaid')
                    this._markInternalLinks();
                this._cancelFinalize = finalizeRenderedDiagram(this.domNode!, i18n.t('Diagram'));
            }
            catch (error) {
                if (generation !== this._generation)
                    return;
                const detail
                    = error instanceof Error ? error.message : String(error);
                debug.error(`render ${type} diagram failed: ${detail}`);
                this.domNode!.innerHTML = `<div class="mu-diagram-error">&lt; ${i18n.t(
                    'Invalid Diagram Code',
                )} &gt;<div class="mu-diagram-error-detail">${sanitize(
                    detail,
                    PREVIEW_DOMPURIFY_CONFIG,
                    true,
                )}</div></div>`;
            }
            finally {
                if (staged)
                    target.remove();
            }
        }
        else {
            this.domNode!.innerHTML = `<div class="${CLASS_NAMES.MU_EMPTY}">&lt; ${i18n.t(
                'Empty Diagram',
            )} &gt;</div>`;
        }
    }

    private _createStaging() {
        const staging = document.createElement('div');
        staging.className = this.domNode!.className;
        staging.setAttribute('aria-hidden', 'true');
        Object.assign(staging.style, {
            position: 'fixed',
            left: '-10000px',
            top: '0',
            visibility: 'hidden',
            width: `${this.domNode!.clientWidth || 800}px`,
        });
        document.body.appendChild(staging);

        return staging;
    }

    private _markInternalLinks() {
        for (const node of this.domNode!.querySelectorAll<SVGElement | HTMLElement>(INTERNAL_LINK_SELECTOR))
            node.style.cursor = 'pointer';
    }
}

export default DiagramPreview;
