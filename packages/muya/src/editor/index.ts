import type { JSONOp, JSONOpComponent, JSONOpList } from 'ot-json1';
import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type { TBlockPath } from '../block/types';
import type { Muya } from '../muya';
import type { IHistorySelection } from '../selection/types';
import type { TState } from '../state/types';
import type { Nullable } from '../types';
import * as otText from 'ot-text-unicode';
import { fromEvent, merge } from 'rxjs';
import { registerBlocks } from '../block';
import { ScrollPage } from '../block/scrollPage';
import Clipboard from '../clipboard';
import { CLASS_NAMES, isFirefox } from '../config';
import History from '../history';
import InlineRenderer from '../inlineRenderer';
import { Search } from '../search';
import Selection from '../selection';
import JSONState from '../state';
import { hasPick, isHTMLElement } from '../utils';
import { getBlock } from '../utils/dom';
import logger from '../utils/logger';
import { Decorations } from './decorations';
import { attachDragDropImageHandlers } from './dragDropImage';
import { attachLinkMouseHandlers } from './linkMouseEvents';

const debug = logger('editor:');

/**
 * Replaces `[start, end)` (UTF-16 offsets) of the content block at `path`
 * with `replacement`, provided that range still reads `expected`.
 */
export interface IRangeEdit {
    path: TBlockPath;
    start: number;
    end: number;
    expected: string;
    replacement: string;
}

// The pick/drop walkers operate on live block-tree nodes (ScrollPage,
// Parent, Content). The tree's instance methods (queryBlock, find,
// insertBefore, etc.) are not all exposed on a single TS type, and
// ot-json1 op descents are dynamically shaped — so we type these as
// BlockNode (loose structural alias) inside the inner walkers and let
// the runtime branches do the actual narrowing.
type BlockNode = {
    queryBlock?: (path: (string | number)[]) => BlockNode | undefined;
    find?: (key: number | string) => BlockNode;
    remove?: (source: string) => void;
    replaceWith?: (newBlock: BlockNode, source: string) => void;
    insertBefore?: (newBlock: BlockNode, ref: BlockNode, source: string) => void;
    append?: (newBlock: BlockNode, source: string) => void;
    update?: (value?: unknown, source?: string) => void;
    blockName?: string;
    align?: string;
    _text?: string;
    text?: string;
    meta?: { lang?: string; type?: string };
    parent?: BlockNode;
} | undefined;

function descend(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
): { subDoc: BlockNode; i: number } {
    let i = 0;

    for (; i < descent.length; i++) {
        const d = descent[i];
        if (Array.isArray(d))
            break;
        if (typeof d === 'object')
            continue;
        stack.push(subDoc);
        // Its valid to descend into a null space - just we can't pick there.
        subDoc = subDoc == null ? undefined : subDoc.queryBlock?.([d]);
    }

    return { subDoc, i };
}

function restore(
    subDoc: BlockNode,
    descent: JSONOpList,
    stack: BlockNode[],
    i: number,
): BlockNode {
    // Then back again.
    for (--i; i >= 0; i--) {
        const d = descent[i];
        if (typeof d !== 'object') {
            const container = stack.pop();
            if (
                subDoc
                === (container == null ? undefined : container.queryBlock?.([d as string | number]))
            ) {
                subDoc = container;
            }
            else {
                if (subDoc === undefined) {
                    // TODO: handler typeof d === 'string'
                    if (typeof d === 'number')
                        container?.find?.(d)?.remove?.('api');
                    subDoc = container;
                }
                else {
                    if (typeof d === 'number')
                        container?.find?.(d)?.replaceWith?.(subDoc, 'api');
                    subDoc = container;
                }
            }
        }
        else if (!Array.isArray(d) && hasPick(d)) {
            subDoc = undefined;
        }
    }

    return subDoc;
}

// Phase 1: Pick. Returns updated subDocument.
function pick(subDoc: BlockNode, descent: JSONOpList): BlockNode {
    const stack: BlockNode[] = [];

    const descended = descend(subDoc, descent, stack);
    subDoc = descended.subDoc;
    const i = descended.i;

    // Children. These need to be traversed in reverse order here.
    for (let j = descent.length - 1; j >= i; j--)
        subDoc = pick(subDoc, descent[j] as JSONOpList);

    return restore(subDoc, descent, stack, i);
}

function drop(root: BlockNode, descent: JSONOpList, muya: Muya): BlockNode {
    let subDoc = root;
    let i = 0; // For reading
    let m = 0;
    const rootContainer: { root: BlockNode } = { root }; // This is an avoidable allocation.
    let container: BlockNode | { root: BlockNode } = rootContainer;
    let key: string | number = 'root'; // For writing

    function mut() {
        for (; m < i; m++) {
            const d = descent[m];
            if (typeof d === 'object')
                continue;
            if (key === 'root') {
                const wrap = container as { root: BlockNode };
                container = wrap.root;
            }
            else {
                container = (container as BlockNode)?.queryBlock?.([key]);
            }
            key = d as string | number;
        }
    }

    function applyInsert(comp: JSONOpComponent) {
        // Insert
        mut();
        const cur = container as BlockNode;
        const ref = cur?.find?.(key);
        if (typeof key === 'number') {
            const insertedState = comp.i as { name: string };
            const newBlock = ScrollPage.loadBlock(insertedState.name).create(muya, insertedState) as BlockNode;
            if (cur && newBlock) {
                if (ref)
                    cur.insertBefore?.(newBlock, ref, 'api');
                else
                    cur.append?.(newBlock, 'api');
            }

            subDoc = newBlock;
        }
        else {
            switch (key) {
                case 'checked': {
                    ref?.update?.(comp.i, 'api');
                    break;
                }

                case 'meta':
                    // Do nothing.
                    break;

                default:
                    debug.warn(`Unknown operation path ${key}`);
                    break;
            }
        }
    }

    function applyTextEdit(es: NonNullable<JSONOpComponent['es']>) {
        // Edit. Ok because its illegal to drop inside mixed region
        mut();
        const sd = subDoc!;
        if (sd.blockName === 'table.cell') {
            sd.align = otText.type.apply(sd.align ?? '', es) as string;
        }
        else if (sd.blockName === 'language-input') {
            sd._text = otText.type.apply(sd.text ?? '', es) as string;
            if (sd.parent?.meta)
                sd.parent.meta.lang = sd.text;
            sd.update?.();
        }
        else if (sd.blockName === 'code-block') {
            // Handle modify code block type.
            if (sd.meta)
                sd.meta.type = otText.type.apply(sd.meta.type ?? '', es) as string;
        }
        else {
            sd._text = otText.type.apply(sd.text ?? '', es) as string;
            sd.update?.();
        }
    }

    for (; i < descent.length; i++) {
        const d = descent[i];

        if (Array.isArray(d)) {
            const child = drop(subDoc, d, muya);
            if (child !== subDoc && child !== undefined) {
                mut();
                // It maybe never go into this if statement.
                if (key === 'root')
                    (container as { root: BlockNode }).root = child;
                else
                    (container as Record<string, BlockNode>)[key] = child;
                subDoc = child;
            }
        }
        else if (typeof d === 'object') {
            const comp = d as JSONOpComponent;
            if (comp.i !== undefined)
                applyInsert(comp);

            if (comp.es)
                applyTextEdit(comp.es);
        }
        else {
            subDoc = subDoc != null ? subDoc.queryBlock?.([d]) : undefined;
        }
    }

    return rootContainer.root;
}

export class Editor {
    jsonState: JSONState;
    inlineRenderer: InlineRenderer;
    selection: Selection;
    searchModule: Search;
    clipboard: Clipboard;
    history: History;
    decorations: Decorations;
    scrollPage: Nullable<ScrollPage> = null;

    private _activeContentBlock: Nullable<Content> = null;

    constructor(private _muya: Muya) {
        const state = _muya.options.json || _muya.options.markdown || '';

        this.jsonState = new JSONState(_muya, state);
        this.inlineRenderer = new InlineRenderer(_muya);
        this.selection = new Selection(_muya);
        this.searchModule = new Search(_muya);
        this.clipboard = Clipboard.create(_muya);
        this.history = new History(_muya);
        this.decorations = new Decorations(_muya);
    }

    get activeContentBlock() {
        return this._activeContentBlock;
    }

    set activeContentBlock(block) {
        const { activeContentBlock: oldActiveContentBlock } = this;
        if (block !== oldActiveContentBlock) {
            this._activeContentBlock = block;
            if (oldActiveContentBlock)
                oldActiveContentBlock.blurHandler();

            if (block)
                block.focusHandler();
        }
    }

    init() {
        registerBlocks();

        const muya = this._muya;
        const state = this.jsonState.getState();

        this.scrollPage = ScrollPage.create(muya, state);

        this._dispatchEvents();
        // Hovering a rendered link wrapper dispatches `muya-link-tools` so the
        // staged popover lights up. Cleanup is handled by `muya.destroy()` →
        // `detachAllDomEvents`.
        attachLinkMouseHandlers(muya);
        // Dropping an image file or web-link image into the editor inserts it
        // as a new `![](src)` block. Cleanup is likewise handled by
        // `detachAllDomEvents`.
        attachDragDropImageHandlers(muya);
        // Registered after `_dispatchEvents` so a click is reported after the
        // block's own click handling and an input after `inputHandler` updated
        // the block text.
        this.decorations.attach();
        this.focus();
    }

    private _dispatchEvents() {
        const { domNode } = this._muya;

        const eventHandler = (event: Event) => {
            const selectionResult = this.selection.getSelection();
            const anchorBlock = selectionResult?.anchor.block;
            const isSelectionInSameBlock = selectionResult?.isSelectionInSameBlock;
            // Fix issue that language input can not get focus when it's empty(Firefox only)
            if (
                event.type === 'click'
                && isFirefox
                && isHTMLElement(event.target)
                && event.target.textContent === ''
                && event.target.classList.contains(CLASS_NAMES.MU_LANGUAGE_INPUT)
            ) {
                (getBlock(event.target) as Content | undefined)?.setCursor(0, 0, true);
                return;
            }

            if (!isSelectionInSameBlock || !anchorBlock) {
                this.activeContentBlock = null;
                return;
            }

            this.activeContentBlock = anchorBlock;

            switch (event.type) {
                case 'click': {
                    anchorBlock.clickHandler(event);
                    break;
                }
                case 'input': {
                    anchorBlock.inputHandler(event);
                    break;
                }
                case 'keydown': {
                    anchorBlock.keydownHandler(event);
                    break;
                }
                case 'keyup': {
                    anchorBlock.keyupHandler(event);
                    break;
                }
                case 'compositionend':
                case 'compositionstart': {
                    anchorBlock.composeHandler(event);
                    break;
                }
            }
        };

        merge(
            fromEvent(domNode, 'click'),
            fromEvent(domNode, 'input'),
            fromEvent(domNode, 'keydown'),
            fromEvent(domNode, 'keyup'),
            fromEvent(domNode, 'compositionend'),
            fromEvent(domNode, 'compositionstart'),
        ).subscribe(eventHandler);
    }

    focus() {
        const { selection, scrollPage } = this;
        const { anchorBlock, anchorPath, anchor, focus } = selection;

        // Restore the user's last caret when it is still in the tree, so a
        // focus() triggered after a blur (e.g. the command palette) keeps
        // block-level commands operating on the block the user was editing
        // rather than the first block of the document.
        if (
            anchorBlock
            && anchor
            && focus
            && scrollPage?.queryBlock(anchorPath) === anchorBlock
        ) {
            anchorBlock.setCursor(anchor.offset, focus.offset, true);
            return;
        }

        // TODO: the cursor maybe passed by muya options.cursor, and no need to find the first leaf block.
        const firstLeafBlock = scrollPage?.firstContentInDescendant();

        if (firstLeafBlock == null)
            return;

        const cursor = {
            path: firstLeafBlock.path,
            block: firstLeafBlock,
            anchor: {
                offset: 0,
            },
            focus: {
                offset: 0,
            },
        };

        const needUpdated
            = firstLeafBlock.blockName === 'paragraph.content'
                && (firstLeafBlock as Format).checkNeedRender(cursor);

        firstLeafBlock.setCursor(0, 0, needUpdated);
    }

    updateContents(operations: JSONOp, selection: Nullable<IHistorySelection>, source: string) {
        const muya = this._muya;
        // ot-json1 no-op (`null`) is forwarded to dispatch — JSONState
        // short-circuits internally so listeners still see a json-change
        // event for the no-op.
        this.jsonState.dispatch(operations, source);

        // Codes bellow are copy from `ot-json1.apply` and modified.
        if (operations === null)
            return;

        try {
            const snapshot = pick(this.scrollPage as BlockNode, operations);

            drop(snapshot, operations, muya);

            this._restoreSelection(selection);
        }
        catch (error) {
            // The incremental walk left the live tree half-applied (pick removed
            // blocks drop never re-inserted). The json state is authoritative and
            // already up to date — rebuild from it instead of leaving an empty doc.
            debug.error(`updateContents incremental apply failed; rebuilding from state: ${String(error)}`);
            this.decorations.preserveAcross(() => this.scrollPage!.updateState(this.jsonState.getState()));
            this._restoreSelection(selection, true);
        }
    }

    private _restoreSelection(selection: Nullable<IHistorySelection>, treeRebuilt = false) {
        if (!selection)
            return;

        const { anchor, focus, isSelectionInSameBlock } = selection;
        // `ScrollPage.queryBlock` consumes the path array in place (`path.shift`),
        // so query against a copy and leave the caller's selection untouched.
        const cursorBlock = this.scrollPage?.queryBlock([...anchor.path]);

        const begin = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);

        if (isSelectionInSameBlock && cursorBlock && cursorBlock.isContent()) {
            cursorBlock.setCursor(begin, end, true);
            return;
        }

        // When the tree was rebuilt wholesale (rebuildContents), the saved
        // selection's cached `anchorBlock` / `focusBlock` reference DETACHED
        // nodes from the previous tree — resolving them would set the native DOM
        // range onto a detached node and crash the next `getSelection()` read.
        // Re-resolve the caret from the (cloned) path against the fresh tree;
        // fall back to focusing the first content block when the saved path no
        // longer points at a content leaf (e.g. a paragraph became a table).
        if (treeRebuilt) {
            if (cursorBlock && cursorBlock.isContent())
                cursorBlock.setCursor(begin, end, true);
            else
                this.focus();

            return;
        }

        // Incremental (updateContents) path. Clone the paths so
        // `queryBlock(path)` can't drain the caller's arrays — notably the
        // selection object stored in the undo stack.
        const anchorBlock = this.scrollPage?.queryBlock([...anchor.path]);
        const focusBlock = this.scrollPage?.queryBlock([...focus.path]);
        if (!anchorBlock || !anchorBlock.isContent() || !focusBlock || !focusBlock.isContent()) {
            this.focus();
            return;
        }

        this.selection.setSelection(
            { offset: anchor.offset, block: anchorBlock, path: [...anchor.path] },
            { offset: focus.offset, block: focusBlock, path: [...focus.path] },
        );
    }

    /**
     * Apply a history op by rebuilding the live block tree wholesale instead of
     * walking it incrementally (`updateContents`). The op is dispatched to the
     * authoritative json state, then `ScrollPage.updateState` re-creates the DOM
     * from that state — the same safe path `setContent` uses. Used for undo/redo
     * of whole-document boundaries (e.g. exiting source-code mode) whose op
     * shapes the incremental pick/drop walker cannot apply without desyncing the
     * DOM from the json state.
     */
    rebuildContents(operations: JSONOp, selection: Nullable<IHistorySelection>, source: string) {
        this.jsonState.dispatch(operations, source);

        const state = this.jsonState.getState();
        this.decorations.preserveAcross(() => this.scrollPage!.updateState(state));

        // The tree was rebuilt wholesale, so the selection's cached block
        // references are stale — resolve the caret from paths instead.
        this._restoreSelection(selection, true);
    }

    setContent(content: TState[] | string, autoFocus = false) {
        this.jsonState.setContent(content);
        const state = this.jsonState.getState();

        this.decorations.reset();
        this.scrollPage!.updateState(state);
        this.history.clear();
        this.searchModule.reset();

        if (autoFocus)
            this.focus();

        this._muya.eventCenter.emit('content-set');
    }

    /**
     * Applies `edit` as its own undo step and puts the caret after the
     * replacement. Returns false, changing nothing, when the path does not
     * resolve to a content block or the range no longer reads `expected`.
     */
    replaceRange(edit: IRangeEdit): boolean {
        const { path, start, end, expected, replacement } = edit;
        if (!Array.isArray(path) || typeof replacement !== 'string')
            return false;

        // `queryBlock` consumes the path array.
        const block = this.scrollPage?.queryBlock([...path]);
        if (!block || !block.isContent())
            return false;

        const { text } = block;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length)
            return false;
        if (text.slice(start, end) !== expected)
            return false;

        this._replaceText(block, start, end, replacement);

        return true;
    }

    /**
     * Replaces the text selection, or inserts at the caret, of the last
     * selected content block, as its own undo step; the caret ends after
     * `text`. Works while the editor is blurred. Returns false when the
     * selection is not inside one content block.
     */
    insertText(text: string): boolean {
        const { anchorBlock, focusBlock, anchor, focus } = this.selection;
        if (typeof text !== 'string' || !anchorBlock || anchorBlock !== focusBlock || !anchorBlock.outMostBlock || !anchor || !focus)
            return false;

        const start = Math.min(anchor.offset, focus.offset);
        const end = Math.max(anchor.offset, focus.offset);
        if (start < 0 || end > anchorBlock.text.length)
            return false;

        this._replaceText(anchorBlock, start, end, text);

        return true;
    }

    private _replaceText(block: Content, start: number, end: number, replacement: string) {
        const { text } = block;
        // Flushing around the edit records it alone: pending keystrokes before
        // it and typing after it each land in their own undo steps.
        this.jsonState.flush();
        this.history.cutoff();
        block.text = text.slice(0, start) + replacement + text.slice(end);
        const offset = start + replacement.length;
        block.setCursor(offset, offset, true);
        this.jsonState.flush();
        this.history.cutoff();
    }
}
