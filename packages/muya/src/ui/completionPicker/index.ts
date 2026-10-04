import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { ICompletionItem, ICompletionTrigger } from '../../completion';
import type { Muya } from '../../index';
import {
    consumedAfterLength,
    findCompletionTrigger,
    setCompletionActive,
} from '../../completion';
import { getCursorReference } from '../../selection';
import { query } from '../../utils/dom';
import { h, patch } from '../../utils/snabbdom';
import BaseScrollFloat from '../baseScrollFloat';
import './index.css';

/** Payload of `muya-completion`, emitted by `Format` after input and keyup. */
interface ICompletionCheckEvent {
    block: Format;
    anchor: number;
    focus: number;
}

interface ISession {
    block: Format;
    text: string;
    caret: number;
    trigger: ICompletionTrigger;
}

const ELIGIBLE_BLOCKS: ReadonlySet<string> = new Set([
    'paragraph.content',
    'atxheading.content',
    'setextheading.content',
    'table.cell.content',
]);

const defaultOptions = {
    placement: 'bottom-start' as const,
    offsetOptions: {
        mainAxis: 4,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

/**
 * Autocomplete list for providers registered with
 * `registerCompletionProvider`. Opens when a provider's trigger matches the
 * text before a collapsed caret in a paragraph, heading or table cell;
 * Up/Down/Tab move, Enter or click inserts, Escape dismisses until the text
 * changes.
 */
export class CompletionPicker extends BaseScrollFloat {
    static pluginName = 'completionPicker';
    public override capturesContentKeydown = true;
    public override renderArray: ICompletionItem[] = [];
    public override activeItem: ICompletionItem | null = null;

    private _oldVNode: VNode | null = null;
    private _session: ISession | null = null;
    // Bumped on every new query or close: stale `getItems` results are dropped.
    private _requestId = 0;
    // A dismissed (or just completed) list stays closed until the text changes.
    private _dismissed: { block: Format; text: string } | null = null;

    constructor(muya: Muya, options = {}) {
        super(muya, 'mu-completion-picker', Object.assign({}, defaultOptions, options));
        this.floatBox!.classList.add('mu-completion-picker-wrapper');
        this.listen();
    }

    override listen() {
        super.listen();
        this.muya.eventCenter.on('muya-completion', (event: ICompletionCheckEvent) => this._check(event));
    }

    private _check({ block, anchor, focus }: ICompletionCheckEvent) {
        const { text } = block;
        const session = this._session;
        if (session && session.block === block && session.text === text && session.caret === anchor && anchor === focus)
            return;

        if (this._dismissed && (this._dismissed.block !== block || this._dismissed.text !== text))
            this._dismissed = null;

        const trigger = anchor === focus && ELIGIBLE_BLOCKS.has(block.blockName) && !this._dismissed
            ? findCompletionTrigger(text.substring(0, anchor))
            : null;
        if (!trigger) {
            this._close();

            return;
        }

        this._session = { block, text, caret: anchor, trigger };
        setCompletionActive(this.muya, true);
        const requestId = ++this._requestId;
        let result: ICompletionItem[] | Promise<ICompletionItem[]>;
        try {
            result = trigger.provider.getItems(trigger.query);
        }
        catch {
            this._close();

            return;
        }

        if (Array.isArray(result)) {
            this._showItems(result);

            return;
        }
        result.then(
            (items) => {
                if (requestId === this._requestId)
                    this._showItems(items);
            },
            () => {
                if (requestId === this._requestId)
                    this._close();
            },
        );
    }

    private _showItems(items: ICompletionItem[]) {
        if (!items.length) {
            // The provider still owns the context; only the empty list hides.
            super.hide();

            return;
        }
        this.renderArray = items;
        this.activeItem = items[0];
        // No caret rect (e.g. a collapsed range the engine cannot measure):
        // anchor the list to the block instead of not showing it.
        const reference = getCursorReference() ?? this._session?.block.domNode;
        if (reference)
            this.show(reference, (item: ICompletionItem) => this._insert(item));
        this.render();
    }

    // Ends the session without marking it dismissed.
    private _close() {
        this._requestId++;
        this._session = null;
        setCompletionActive(this.muya, false);
        super.hide();
    }

    private _insert(item: ICompletionItem) {
        const session = this._session;
        if (!session || session.block.text !== session.text)
            return;

        const { block, text, caret, trigger } = session;
        const end = caret + consumedAfterLength(trigger.provider, text.substring(caret));
        const { insertText } = item;
        const caretOffset = Math.min(Math.max(item.caretOffset ?? insertText.length, 0), insertText.length);
        const nextText = text.substring(0, trigger.start) + insertText + text.substring(end);
        const offset = trigger.start + caretOffset;

        this._close();
        this._dismissed = { block, text: nextText };

        // One undo step: flush pending typing, then fence the edit with cutoffs.
        const { jsonState, history } = this.muya.editor;
        jsonState.flush();
        history.cutoff();
        block.text = nextText;
        jsonState.flush();
        history.cutoff();
        block.setCursor(offset, offset, true);
    }

    override hide() {
        if (this._session)
            this._dismissed = { block: this._session.block, text: this._session.text };
        this._close();
    }

    render() {
        const { renderArray, _oldVNode: oldVNode, scrollElement, activeItem } = this;
        const children = renderArray.map((item, index) => {
            const selector = activeItem === item ? 'li.item.active' : 'li.item';
            const content = [h('span.label', item.label)];
            if (item.detail)
                content.push(h('span.detail', item.detail));

            return h(
                selector,
                {
                    dataset: { index: String(index) },
                    on: {
                        click: () => {
                            this.selectItem(item);
                        },
                    },
                },
                content,
            );
        });

        const vnode = h('ul', children);

        if (oldVNode)
            patch(oldVNode, vnode);
        else
            patch(scrollElement!, vnode);

        this._oldVNode = vnode;
    }

    getItemElement(item: ICompletionItem): HTMLElement | null {
        const index = this.renderArray.indexOf(item);
        if (index < 0)
            return null;

        return query<HTMLElement>(`[data-index="${index}"]`, this.floatBox!);
    }

    override destroy() {
        this._close();
        super.destroy();
    }
}

export default CompletionPicker;
