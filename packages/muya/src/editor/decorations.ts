import type Content from '../block/base/content';
import type TreeNode from '../block/base/treeNode';
import type { TBlockPath } from '../block/types';
import type { IHighlight, IHighlightDecoration } from '../inlineRenderer/types';
import type { Muya } from '../muya';
import { findContentDOM } from '../selection/dom';
import { getBlock } from '../utils/dom';

/**
 * A render-only mark over `[start, end)` (UTF-16 offsets) of one content
 * block's text. It never reaches the document state, the markdown or the
 * history.
 */
export interface IDecorationRange {
    path: TBlockPath;
    start: number;
    end: number;
    /** Whitespace-separated CSS classes for the marked text. */
    className: string;
    /** Rendered as `data-<key>` attributes; keys outside `[\w-]` are skipped. */
    data?: Record<string, string>;
}

/** Payload of the `decoration-click` event. */
export interface IDecorationClickPayload {
    layerId: string;
    /** The clicked range, with `path` resolved against the current document. */
    range: IDecorationRange;
    /** Viewport rectangle of the clicked span, read before any re-render. */
    rect: DOMRect;
    event: MouseEvent;
}

/** Blocks rendered through `InlineRenderer.patch`, the only ones that paint decorations. */
export const INLINE_RENDERED_BLOCKS: Readonly<Record<string, true>> = {
    'paragraph.content': true,
    'atxheading.content': true,
    'setextheading.content': true,
    'table.cell.content': true,
    'thematicbreak.content': true,
};

const DECORATION_SELECTOR = '[data-mu-decoration-layer]';

interface IBlockDecorations {
    /** `block.text` the ranges were set against; any other text invalidates every layer. */
    text: string;
    layers: Map<string, IDecorationRange[]>;
}

interface IPaintItem {
    start: number;
    end: number;
    decoration: IHighlightDecoration;
}

type TQueryable = TreeNode & { queryBlock: (path: TBlockPath) => TreeNode | null | undefined };

function isQueryable(node: TreeNode): node is TQueryable {
    return 'queryBlock' in node && typeof node.queryBlock === 'function';
}

function childrenOf(node: TreeNode): TreeNode[] {
    const result: TreeNode[] = [];
    if (node.isParent()) {
        for (let child = node.children.head; child; child = child.next)
            result.push(child);
    }

    return result;
}

// Content blocks of the tree in document order, without the O(n) `offset`
// lookups `block.path` performs.
function contentBlocksInOrder(root: TreeNode): Content[] {
    const result: Content[] = [];
    const stack: TreeNode[] = [root];

    while (stack.length) {
        const node = stack.pop()!;
        if (node.isContent()) {
            result.push(node);
            continue;
        }
        const children = childrenOf(node);
        for (let i = children.length - 1; i >= 0; i--)
            stack.push(children[i]);
    }

    return result;
}

function lowerBound(points: number[], value: number) {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid] < value)
            lo = mid + 1;
        else
            hi = mid;
    }

    return lo;
}

function sameRanges(a: IDecorationRange[], b: IDecorationRange[]) {
    if (a.length !== b.length)
        return false;

    return a.every((range, i) => {
        const other = b[i];
        if (range.start !== other.start || range.end !== other.end || range.className !== other.className)
            return false;
        const keys = Object.keys(range.data ?? {});
        const otherKeys = Object.keys(other.data ?? {});

        return keys.length === otherKeys.length && keys.every(key => range.data![key] === other.data?.[key]);
    });
}

/**
 * Splits search highlights and decorations of one block into sorted, disjoint
 * segments. The inline renderer paints each highlight as its own span, so
 * overlapping input would duplicate characters in the DOM, and
 * `Format.inputHandler` would then write the duplicates into the document.
 *
 * On a segment covered by several matches the active one wins. Decorations
 * nest widest outermost, ties in input order.
 */
export function mergeHighlightSegments(
    textLength: number,
    highlights: IHighlight[],
    decorations: IPaintItem[],
): IHighlight[] {
    const clamp = (value: number) => Math.min(Math.max(value, 0), textLength);
    const lights = highlights
        .map(light => ({ start: clamp(light.start), end: clamp(light.end), active: !!light.active }))
        .filter(light => light.start < light.end);
    const items = decorations
        .map(item => ({ ...item, start: clamp(item.start), end: clamp(item.end) }))
        .filter(item => item.start < item.end);

    if (!lights.length && !items.length)
        return [];

    const points = [...new Set([...lights, ...items].flatMap(({ start, end }) => [start, end]))]
        .sort((a, b) => a - b);
    const segmentCount = points.length - 1;
    // 0: no match, 1: inactive match, 2: active match.
    const matchState = new Uint8Array(segmentCount);
    const covering: (IHighlightDecoration[] | undefined)[] = Array.from({ length: segmentCount });

    for (const light of lights) {
        const state = light.active ? 2 : 1;
        for (let k = lowerBound(points, light.start); points[k] < light.end; k++)
            matchState[k] = Math.max(matchState[k], state);
    }

    // Stable sort: equal widths keep input order.
    const ordered = items
        .map((item, order) => ({ item, order }))
        .sort((a, b) => (b.item.end - b.item.start) - (a.item.end - a.item.start) || a.order - b.order);
    for (const { item } of ordered) {
        for (let k = lowerBound(points, item.start); points[k] < item.end; k++)
            (covering[k] ??= []).push(item.decoration);
    }

    const result: IHighlight[] = [];
    for (let k = 0; k < segmentCount; k++) {
        const state = matchState[k];
        const decos = covering[k];
        if (state === 0 && !decos)
            continue;

        const segment: IHighlight = { start: points[k], end: points[k + 1], active: state === 2 };
        if (state === 0) {
            segment.active = undefined;
            segment.decorationOnly = true;
        }
        if (decos)
            segment.decorations = decos;
        result.push(segment);
    }

    return result;
}

/**
 * Decoration layers of one editor. Ranges are stored per block instance
 * together with the text they were computed for: a re-render with unchanged
 * text repaints them, a text change drops all layers of that block.
 */
export class Decorations {
    private _blocks = new Map<Content, IBlockDecorations>();
    private _composing = false;
    // Active blocks whose repaint waits for the IME composition to end.
    private _deferred = new Set<Content>();

    constructor(private _muya: Muya) {}

    /** Replaces every range of `layerId`; re-renders only blocks whose ranges changed. */
    set(layerId: string, ranges: IDecorationRange[]) {
        const incoming = this._resolve(ranges);
        const dirty = new Set<Content>();

        for (const [block, entry] of this._blocks) {
            // Also forgets blocks removed from the document since.
            if (entry.text !== block.text || !block.outMostBlock) {
                this._blocks.delete(block);
                dirty.add(block);
                continue;
            }
            const previous = entry.layers.get(layerId);
            if (!previous)
                continue;

            const next = incoming.get(block);
            if (next && sameRanges(previous, next)) {
                incoming.delete(block);
                continue;
            }

            entry.layers.delete(layerId);
            if (!entry.layers.size)
                this._blocks.delete(block);
            dirty.add(block);
        }

        for (const [block, list] of incoming) {
            let entry = this._blocks.get(block);
            if (!entry) {
                entry = { text: block.text, layers: new Map() };
                this._blocks.set(block, entry);
            }
            entry.layers.set(layerId, list);
            dirty.add(block);
        }

        this._render(dirty);
    }

    /** Removes one layer, or every layer when `layerId` is omitted. */
    clear(layerId?: string) {
        const dirty = new Set<Content>();

        for (const [block, entry] of this._blocks) {
            if (layerId != null && !entry.layers.has(layerId))
                continue;

            if (layerId == null)
                entry.layers.clear();
            else
                entry.layers.delete(layerId);

            if (!entry.layers.size)
                this._blocks.delete(block);
            dirty.add(block);
        }

        this._render(dirty);
    }

    /** Forgets every layer without re-rendering; for a document replacement. */
    reset() {
        this._blocks.clear();
        this._deferred.clear();
    }

    /**
     * The disjoint segments `block` paints: `highlights` (search matches)
     * merged with its stored decorations. Drops the block's decorations when
     * its text changed since they were set.
     */
    paintSegments(block: Content, highlights: IHighlight[]): IHighlight[] {
        let entry = this._blocks.get(block);
        if (entry && entry.text !== block.text) {
            this._blocks.delete(block);
            entry = undefined;
        }

        if (!entry)
            return highlights.length ? mergeHighlightSegments(block.text.length, highlights, []) : highlights;

        const items: IPaintItem[] = [];
        for (const [layerId, ranges] of entry.layers) {
            ranges.forEach(({ start, end, className, data }, index) => {
                items.push({ start, end, decoration: { layerId, index, className, data } });
            });
        }

        return mergeHighlightSegments(block.text.length, highlights, items);
    }

    /**
     * Runs `rebuild`, which re-creates the block tree from the same state
     * (`ScrollPage.updateState`), and moves the decorations onto the new
     * instances. Blocks are matched by document order and must keep their text.
     */
    preserveAcross(rebuild: () => void) {
        const page = this._muya.editor.scrollPage;
        if (!page || !this._blocks.size) {
            this._blocks.clear();
            rebuild();
            return;
        }

        const saved = new Map<number, IBlockDecorations>();
        contentBlocksInOrder(page).forEach((block, ordinal) => {
            const entry = this._blocks.get(block);
            if (entry && entry.text === block.text)
                saved.set(ordinal, entry);
        });
        this.reset();

        rebuild();

        const dirty = new Set<Content>();
        contentBlocksInOrder(page).forEach((block, ordinal) => {
            const entry = saved.get(ordinal);
            if (entry && entry.text === block.text && INLINE_RENDERED_BLOCKS[block.blockName] === true) {
                this._blocks.set(block, entry);
                dirty.add(block);
            }
        });
        this._render(dirty);
    }

    /** Listens for decoration clicks and for edits that invalidate decorations. */
    attach() {
        const { domNode, eventCenter } = this._muya;

        eventCenter.attachDOMEvent(domNode, 'click', this._clickHandler);
        eventCenter.attachDOMEvent(domNode, 'input', this._inputHandler);
        eventCenter.attachDOMEvent(domNode, 'compositionstart', this._compositionStartHandler);
        eventCenter.attachDOMEvent(domNode, 'compositionend', this._compositionEndHandler);
    }

    private _resolve(ranges: IDecorationRange[]) {
        const result = new Map<Content, IDecorationRange[]>();
        const blockByPath = new Map<string, Content | null>();
        const resolve = this._pathResolver();

        for (const range of ranges) {
            if (!range || !Array.isArray(range.path) || typeof range.className !== 'string')
                continue;

            const key = JSON.stringify(range.path);
            let block = blockByPath.get(key);
            if (block === undefined) {
                block = resolve(range.path);
                blockByPath.set(key, block);
            }
            if (!block)
                continue;

            const length = block.text.length;
            const start = Math.max(0, Math.min(Number(range.start), length));
            const end = Math.min(Number(range.end), length);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
                continue;

            const stored: IDecorationRange = { path: [...range.path], start, end, className: range.className };
            if (range.data)
                stored.data = { ...range.data };

            const list = result.get(block);
            if (list)
                list.push(stored);
            else
                result.set(block, [stored]);
        }

        for (const list of result.values())
            list.sort((a, b) => a.start - b.start || a.end - b.end);

        return result;
    }

    // `ScrollPage.queryBlock` finds top-level blocks with an O(n) array copy;
    // index them once so resolving a range per paragraph stays linear.
    private _pathResolver() {
        const page = this._muya.editor.scrollPage;
        let topLevel: TreeNode[] | null = null;

        return (path: TBlockPath): Content | null => {
            if (!page || typeof path[0] !== 'number')
                return null;

            topLevel ??= childrenOf(page);
            const first = topLevel[path[0]];
            if (!first)
                return null;

            const rest = path.slice(1);
            const block = rest.length ? (isQueryable(first) ? first.queryBlock(rest) : null) : first;

            return block && block.isContent() && INLINE_RENDERED_BLOCKS[block.blockName] === true ? block : null;
        };
    }

    private _searchHighlights() {
        const { matches, index } = this._muya.editor.searchModule;
        const result = new Map<Content, IHighlight[]>();

        matches.forEach(({ block, start, end }, i) => {
            const light: IHighlight = { start, end, active: i === index };
            const list = result.get(block);
            if (list)
                list.push(light);
            else
                result.set(block, [light]);
        });

        return result;
    }

    private _render(blocks: Set<Content>) {
        if (!blocks.size)
            return;

        const { editor } = this._muya;
        const searchHighlights = this._searchHighlights();

        editor.inlineRenderer.batch(() => {
            for (const block of blocks) {
                if (!block.domNode || !block.outMostBlock)
                    continue;

                const highlights = searchHighlights.get(block);
                if (block !== editor.activeContentBlock) {
                    block.update(undefined, highlights);
                    continue;
                }

                // Replacing the active block's innerHTML would cancel an IME
                // composition; repaint once it ends.
                if (this._composing) {
                    this._deferred.add(block);
                    continue;
                }

                const cursor = block.getCursor();
                if (!cursor) {
                    block.update(undefined, highlights);
                    continue;
                }

                block.update({ ...cursor, block }, highlights);
                block.setCursor(cursor.anchor.offset, cursor.focus.offset);
            }
        });
    }

    private _clickHandler = (event: Event) => {
        if (!(event instanceof MouseEvent))
            return;
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
            return;

        const { target } = event;
        if (!(target instanceof Element))
            return;

        const span = target.closest<HTMLElement>(DECORATION_SELECTOR);
        if (!span || !this._muya.domNode.contains(span))
            return;

        // A drag-selection that ends on a decoration is not a click on it.
        const selection = document.getSelection();
        if (selection && !selection.isCollapsed)
            return;

        const block = getBlock(findContentDOM(span));
        if (!block || !block.isContent())
            return;

        const entry = this._blocks.get(block);
        const layerId = span.getAttribute('data-mu-decoration-layer');
        if (!entry || entry.text !== block.text || layerId == null)
            return;

        const range = entry.layers.get(layerId)?.[Number(span.getAttribute('data-mu-decoration-index'))];
        if (!range)
            return;

        // Read synchronously: `Format.clickHandler` re-renders on the next frame.
        const payload: IDecorationClickPayload = {
            layerId,
            range: { ...range, path: block.path, ...(range.data ? { data: { ...range.data } } : {}) },
            rect: span.getBoundingClientRect(),
            event,
        };
        this._muya.eventCenter.emit('decoration-click', payload);
    };

    // Typing that the browser applies to the DOM without a re-render leaves
    // the old spans in place: drop the block's decorations and unstyle them.
    private _inputHandler = () => {
        const block = this._muya.editor.activeContentBlock;
        if (!block)
            return;

        const entry = this._blocks.get(block);
        if (!entry || entry.text === block.text)
            return;

        this._blocks.delete(block);
        this._deferred.delete(block);
        for (const span of block.domNode?.querySelectorAll(DECORATION_SELECTOR) ?? []) {
            while (span.attributes.length)
                span.removeAttribute(span.attributes[0].name);
        }
    };

    private _compositionStartHandler = () => {
        this._composing = true;
    };

    private _compositionEndHandler = () => {
        this._composing = false;
        this._inputHandler();

        const deferred = new Set([...this._deferred].filter(block => this._blocks.has(block)));
        this._deferred.clear();
        this._render(deferred);
    };
}
