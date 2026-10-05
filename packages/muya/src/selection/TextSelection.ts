import type Content from '../block/base/content';
import type Format from '../block/base/format';
import type BulletList from '../block/commonMark/bulletList';
import type OrderList from '../block/commonMark/orderList';
import type TableBodyCell from '../block/gfm/table/cell';
import type TaskList from '../block/gfm/taskList';
import type { TBlockPath } from '../block/types';
import type { Muya } from '../muya';
import type { Nullable } from '../types';
import type Selection from './index';
import type { IAnchorFocusInfo, INodeOffset, ISelection, ISelectionEndpoints } from './types';
import { isHTMLElement, isMouseEvent, isPointerEvent } from '../utils';
import logger from '../utils/logger';
import {
    buildSelectionAffiliation,
    endpointBlockInfo,
} from './affiliation';
import { getCursorCoords, getCursorReference } from './cursorCoords';
import {
    compareParagraphsOrder,
    getLegalOffset,
    getNodeAndOffset,
    lineAtPoint,
    resolveEndpoint,
} from './dom';
import { SelectionCaretType, SelectionDirection, SelectionType } from './types';

const debug = logger('textselection:');

// Code, table and tight-list content is newline-separated; anything else needs
// a blank line, which is also what would re-parse a tight list as loose.
function getTextSeparator(previous: Content, next: Content): string {
    const ancestors = next.getAncestors();
    let container = previous.getAncestors().find(block => ancestors.includes(block));
    if (container?.blockName === 'list-item' || container?.blockName === 'task-list-item')
        container = container.parent ?? undefined;

    if (container?.blockName === 'code-block' || container?.blockName.startsWith('table'))
        return '\n';

    if (container && ['bullet-list', 'order-list', 'task-list'].includes(container.blockName)) {
        const list = container as BulletList | OrderList | TaskList;
        return list.meta.loose ? '\n\n' : '\n';
    }

    return '\n\n';
}

function computeDirection(
    anchorBlock: Content,
    focusBlock: Content,
    anchorOffset: number,
    focusOffset: number,
    isSelectionInSameBlock: boolean,
): SelectionDirection {
    if (isSelectionInSameBlock) {
        return anchorOffset < focusOffset
            ? SelectionDirection.FORWARD
            : SelectionDirection.BACKWARD;
    }

    return compareParagraphsOrder(anchorBlock.domNode!, focusBlock.domNode!)
        ? SelectionDirection.FORWARD
        : SelectionDirection.BACKWARD;
}

function computeCaretType(
    anchorBlock: Nullable<Content>,
    focusBlock: Nullable<Content>,
    isCollapsed: boolean,
): SelectionCaretType {
    if (!anchorBlock && !focusBlock)
        return SelectionCaretType.NONE;

    return isCollapsed ? SelectionCaretType.CARET : SelectionCaretType.RANGE;
}

class TextSelection {
    public anchorPath: TBlockPath = [];
    public anchorBlock: Nullable<Content> = null;
    public focusPath: TBlockPath = [];
    public focusBlock: Nullable<Content> = null;
    public anchor: Nullable<INodeOffset> = null;
    public focus: Nullable<INodeOffset> = null;

    private _doc: Document = document;

    private _selectInfo: {
        isSelect: boolean;
        selection: ISelectionEndpoints | null;
    } = {
        isSelect: false,
        selection: null,
    };

    // `pointerType` of the latest press anywhere in the document. Selections
    // made with a finger arrive only as `selectionchange` (long-press, then the
    // system handles), never as pointer moves or a click.
    private _lastPointerType = '';
    private _touchSyncFrame: number | null = null;

    constructor(private _muya: Muya, private _selection: Selection) {
        this._listenSelectActions();
    }

    private get _scrollPage() {
        return this._muya.editor.scrollPage;
    }

    private get _isCollapsed() {
        const { anchorBlock, focusBlock, anchor, focus } = this;

        if (anchor == null || focus == null)
            return false;

        return anchorBlock === focusBlock && anchor.offset === focus.offset;
    }

    get isSelectionInSameBlock() {
        const { anchorBlock, focusBlock, anchor, focus } = this;

        if (anchor == null || focus == null)
            return false;

        return anchorBlock === focusBlock;
    }

    private get _direction() {
        const {
            anchor,
            focus,
            anchorBlock,
            focusBlock,
            isSelectionInSameBlock,
            _isCollapsed: isCollapsed,
        } = this;
        if (anchor == null || focus == null || !anchorBlock || !focusBlock)
            return SelectionDirection.NONE;

        if (isCollapsed)
            return SelectionDirection.NONE;

        return computeDirection(
            anchorBlock,
            focusBlock,
            anchor.offset,
            focus.offset,
            isSelectionInSameBlock,
        );
    }

    private get _type() {
        const { anchorBlock, focusBlock, _isCollapsed: isCollapsed } = this;

        return computeCaretType(anchorBlock, focusBlock, isCollapsed);
    }

    collapse(): void {
        this.anchor = null;
        this.focus = null;
        this.anchorBlock = null;
        this.focusBlock = null;
        this.anchorPath = [];
        this.focusPath = [];
        this._updateSelection();
        this._emitSelectionChange();
    }

    selectAllContent() {
        const { _scrollPage: scrollPage } = this;
        const aBlock = scrollPage?.firstContentInDescendant();
        const fBlock = scrollPage?.lastContentInDescendant();

        if (aBlock == null || fBlock == null)
            return;

        this.setSelection(
            { offset: 0, block: aBlock, path: aBlock.path },
            { offset: fBlock.text.length, block: fBlock, path: fBlock.path },
        );
        const activeEle = this._doc.activeElement;
        if (isHTMLElement(activeEle) && activeEle.classList.contains('mu-content'))
            activeEle.blur();
    }

    getSelection(): ISelection | null {
        const selection = this._doc.getSelection();

        if (!selection)
            return null;

        const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;

        if (!anchorNode || !focusNode)
            return null;

        const anchor = resolveEndpoint(anchorNode, anchorOffset);
        const focus = resolveEndpoint(focusNode, focusOffset);

        if (!anchor || !focus)
            return null;

        const anchorBlock = anchor.block;
        const focusBlock = focus.block;
        const isCollapsed = anchorBlock === focusBlock && anchor.offset === focus.offset;
        const isSelectionInSameBlock = anchorBlock === focusBlock;

        return {
            anchor,
            focus,
            isCollapsed,
            isSelectionInSameBlock,
            direction: computeDirection(
                anchorBlock,
                focusBlock,
                anchor.offset,
                focus.offset,
                isSelectionInSameBlock,
            ),
            type: computeCaretType(anchorBlock, focusBlock, isCollapsed),
        };
    }

    getSelectedText(): string {
        const selection = this.getSelection();
        if (!selection || selection.isCollapsed)
            return '';

        const { anchor, focus, direction } = selection;
        // `getSelection()` resolves whichever editor the range landed in.
        if (anchor.block.muya !== this._muya || focus.block.muya !== this._muya)
            return '';

        const [start, end] = direction === SelectionDirection.BACKWARD ? [focus, anchor] : [anchor, focus];
        if (start.block === end.block)
            return start.block.text.slice(start.offset, end.offset);

        const parts = [start.block.text.slice(start.offset)];
        let previous = start.block;
        let block = previous.nextContentInContext();
        while (block) {
            parts.push(getTextSeparator(previous, block), block === end.block ? block.text.slice(0, end.offset) : block.text);
            if (block === end.block)
                return parts.join('');
            previous = block;
            block = block.nextContentInContext();
        }

        // `direction` is DOM order, the walk is tree order: they disagree only
        // for a block no longer in the document.
        debug.warn('the selection end is not reachable from its start');

        return '';
    }

    setSelection(anchor: IAnchorFocusInfo, focus: IAnchorFocusInfo) {
        this.anchor = { offset: anchor.offset };
        this.anchorBlock = anchor.block;
        this.anchorPath = anchor.path;
        this.focus = { offset: focus.offset };
        this.focusBlock = focus.block;
        this.focusPath = focus.path;
        this._updateSelection();
        this._emitSelectionChange();
    }

    private _emitSelectionChange() {
        const { _isCollapsed: isCollapsed, isSelectionInSameBlock, _direction: direction, _type: type } = this;
        const anchorBlock = this.anchorBlock ?? null;
        const focusBlock = this.focusBlock ?? null;

        // Follow the caret (focus end) for forward selections so typewriter
        // scrolling tracks the cursor rather than the selection start.
        const cursorCoords = getCursorCoords(direction === SelectionDirection.FORWARD);
        // Duck-type the Format block — a value import of Format here would
        // create a selection -> format circular dependency.
        const anchorBlockRef = anchorBlock as Format | null;
        const formats
            = isSelectionInSameBlock
                && anchorBlockRef
                && typeof anchorBlockRef.getFormatsInRange === 'function'
                ? anchorBlockRef.getFormatsInRange().formats
                : [];

        const affiliation = buildSelectionAffiliation(anchorBlock, focusBlock);

        this._muya.eventCenter.emit('selection-change', {
            anchor: this.anchor,
            focus: this.focus,
            anchorBlock,
            anchorPath: this.anchorPath,
            focusBlock,
            focusPath: this.focusPath,
            isCollapsed,
            isSelectionInSameBlock,
            direction,
            type,
            kind: SelectionType.TEXT,
            selectedImage: this._selection.image,
            cursorCoords,
            formats,
            affiliation,
            anchorBlockInfo: endpointBlockInfo(anchorBlock),
            focusBlockInfo: endpointBlockInfo(focusBlock),
        });
    }

    private _listenSelectActions() {
        const { eventCenter, domNode } = this._muya;

        const handlePointerdown = (event: Event) => {
            // A finger drag scrolls the page rather than selecting text, so it
            // never starts a drag-select.
            this._selectInfo = {
                isSelect: isPointerEvent(event) && event.pointerType !== 'touch',
                selection: null,
            };
        };

        // Triple-click stays on `mousedown`: pointer events always report
        // `detail` 0, and only a cancelled `mousedown` stops the native
        // paragraph selection.
        const handleMousedown = (event: Event) => {
            if (!isMouseEvent(event) || event.button !== 0 || event.detail < 3)
                return;

            const line = lineAtPoint(this._doc, event.clientX, event.clientY);
            if (!line)
                return;

            event.preventDefault();
            this._selectInfo.isSelect = false;
            line.block.setCursor(line.start, line.end);
        };

        const handlePointerupOrLeave = () => {
            const { selection } = this._selectInfo;
            if (selection?.anchor.block.outMostBlock && selection.focus.block.outMostBlock)
                this.setSelection(selection.anchor, selection.focus);

            this._selectInfo = {
                isSelect: false,
                selection: null,
            };
        };

        const handlePointermoveOrClick = (event: Event) => {
            if (!isMouseEvent(event))
                return;

            const { type, shiftKey } = event;
            if (type === 'pointermove' && !this._selectInfo.isSelect)
                return;

            if (type === 'click' && !shiftKey)
                return;

            const selection = this.getSelection();
            if (!selection)
                return;

            const { anchor, focus, isSelectionInSameBlock } = selection;

            if (isSelectionInSameBlock) {
                return;
            }

            const anchorBlock = anchor.block;
            const focusBlock = focus.block;
            const endpointAnchor = { offset: anchor.offset, block: anchorBlock, path: anchorBlock.path };
            const endpointFocus = { offset: focus.offset, block: focusBlock, path: focusBlock.path };

            if (type === 'pointermove')
                this._selectInfo.selection = { anchor: endpointAnchor, focus: endpointFocus };
            else
                this.setSelection(endpointAnchor, endpointFocus);
        };

        const trackPointerType = (event: Event) => {
            if (isPointerEvent(event))
                this._lastPointerType = event.pointerType;
        };

        // Coalesce the burst a handle drag produces into one sync per frame.
        const handleSelectionchange = () => {
            if (this._lastPointerType !== 'touch' || this._touchSyncFrame != null)
                return;

            this._touchSyncFrame = requestAnimationFrame(() => {
                this._touchSyncFrame = null;
                this._syncTouchSelection();
            });
        };

        eventCenter.attachDOMEvent(domNode, 'pointerdown', handlePointerdown);
        eventCenter.attachDOMEvent(domNode, 'mousedown', handleMousedown);
        eventCenter.attachDOMEvent(domNode, 'pointermove', handlePointermoveOrClick);
        eventCenter.attachDOMEvent(domNode, 'pointerup', handlePointerupOrLeave);
        eventCenter.attachDOMEvent(domNode, 'pointerleave', handlePointerupOrLeave);
        eventCenter.attachDOMEvent(domNode, 'pointercancel', handlePointerupOrLeave);
        eventCenter.attachDOMEvent(domNode, 'click', handlePointermoveOrClick);
        eventCenter.attachDOMEvent(this._doc, 'pointerdown', trackPointerType, true);
        eventCenter.attachDOMEvent(this._doc, 'selectionchange', handleSelectionchange);
    }

    /**
     * Adopt a selection the user made with a finger. It is read from the DOM
     * and never written back: re-applying the range would dismiss the system
     * selection handles mid-drag.
     */
    private _syncTouchSelection() {
        const { domNode, eventCenter, editor } = this._muya;
        if (!domNode.isConnected)
            return;

        const native = this.getSelection();
        if (!native)
            return;

        const { anchor, focus, isCollapsed, isSelectionInSameBlock } = native;
        if (anchor.block.muya !== this._muya || focus.block.muya !== this._muya)
            return;

        const tableSelection = this._selection.table;
        const anchorCell = anchor.block.closestBlock('table.cell') as TableBodyCell | null;
        const focusCell = focus.block.closestBlock('table.cell') as TableBodyCell | null;
        if (anchorCell && focusCell && anchorCell !== focusCell && anchorCell.table === focusCell.table) {
            tableSelection.followCellRange(anchorCell, focusCell);

            return;
        }
        if (tableSelection.followsNativeRange)
            tableSelection.clear();

        // A caret comes from a tap, whose `click` already placed it through the
        // block's click handler.
        if (isCollapsed) {
            eventCenter.emit('muya-format-picker', { reference: null });

            return;
        }

        if (
            this.anchorBlock === anchor.block
            && this.focusBlock === focus.block
            && this.anchor?.offset === anchor.offset
            && this.focus?.offset === focus.offset
        ) {
            return;
        }

        this.anchor = { offset: anchor.offset };
        this.anchorBlock = anchor.block;
        this.anchorPath = anchor.block.path;
        this.focus = { offset: focus.offset };
        this.focusBlock = focus.block;
        this.focusPath = focus.block.path;
        editor.activeContentBlock = isSelectionInSameBlock ? anchor.block : null;
        this._emitSelectionChange();

        // Duck-typed like `_emitSelectionChange`: only Format blocks carry
        // inline formats, so code and other plain-text blocks get no toolbar.
        const block = anchor.block as Format;
        if (isSelectionInSameBlock && typeof block.getFormatsInRange === 'function') {
            eventCenter.emit('muya-format-picker', {
                reference: getCursorReference(),
                block,
                touch: true,
            });
        }
    }

    private _selectRange(range: Range) {
        const selection = this._doc.getSelection();

        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    private _select(
        startNode: Node,
        startOffset: number,
        endNode?: Node,
        endOffset?: number,
    ) {
        const range = this._doc.createRange();
        range.setStart(startNode, getLegalOffset(startNode, startOffset));
        if (endNode && typeof endOffset === 'number')
            range.setEnd(endNode, getLegalOffset(endNode, endOffset));
        else
            range.collapse(true);

        this._selectRange(range);

        return range;
    }

    private _setFocus(focusNode: Node, focusOffset: number) {
        const selection = this._doc.getSelection();
        if (selection)
            selection.extend(focusNode, getLegalOffset(focusNode, focusOffset));
    }

    private _updateSelection() {
        const {
            anchor,
            focus,
            anchorBlock,
            anchorPath,
            focusBlock,
            focusPath,
            _scrollPage: scrollPage,
        } = this;

        if (!anchor || !focus) {
            const selection = this._doc.getSelection();

            if (selection)
                selection.removeAllRanges();

            return;
        }

        const anchorParagraph = anchorBlock
            ? anchorBlock.domNode
            : scrollPage?.queryBlock(anchorPath);
        const focusParagraph = focusBlock
            ? focusBlock.domNode
            : scrollPage?.queryBlock(focusPath);

        // getNodeAndOffset expects a DOM Node. The fallback branch can hand
        // back a Parent/Content block (from scrollPage.queryBlock); narrow to
        // an actual Node here, preserving the existing not-found behavior.
        if (!(anchorParagraph instanceof Node) || !(focusParagraph instanceof Node))
            return;
        const { node: anchorNode, offset: anchorOffset } = getNodeAndOffset(
            anchorParagraph,
            anchor.offset,
        );
        const { node: focusNode, offset: focusOffset } = getNodeAndOffset(
            focusParagraph,
            focus.offset,
        );

        this._select(anchorNode, anchorOffset);
        this._setFocus(focusNode, focusOffset);
    }
}

export default TextSelection;
