// @vitest-environment happy-dom

import type Table from '../../block/gfm/table';
import type TableBodyCell from '../../block/gfm/table/cell';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// Coverage for the restored cross-cell table selection (Phase G). Dragging a
// rectangle of table cells highlights them and makes copy/cut operate on just
// that sub-range (legacy `tableSelectCellsCtrl`). These tests drive the
// `TableRectSelection` controller through real DOM pointer events and the
// `Clipboard` through a synthetic `copy`/`cut` event so the whole path —
// selection -> highlight -> clipboard payload / in-place clear — is exercised.

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

const TABLE_MD = [
    '| a1 | b1 | c1 |',
    '| --- | --- | --- |',
    '| a2 | b2 | c2 |',
    '| a3 | b3 | c3 |',
    '',
].join('\n');

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function firstTable(muya: Muya): Table {
    return muya.editor.scrollPage!.firstContentInDescendant()!.closestBlock('table') as Table;
}

function cellDom(table: Table, row: number, column: number): HTMLElement {
    const cell = table.cellAt(row, column) as TableBodyCell;
    // Fire the event from the editable content node so `closest('td...')`
    // resolves to the cell exactly like a real pointer would.
    return (cell.firstChild as { domNode: HTMLElement }).domNode;
}

function firePointer(node: HTMLElement, type: string, pointerType = 'mouse'): void {
    node.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerType }));
}

// Drag-select the rectangle whose corners are (r1,c1) and (r2,c2).
function dragSelect(table: Table, r1: number, c1: number, r2: number, c2: number): void {
    firePointer(cellDom(table, r1, c1), 'pointerdown');
    firePointer(cellDom(table, r2, c2), 'pointermove');
    firePointer(cellDom(table, r2, c2), 'pointerup');
}

function selectedCount(table: Table): number {
    return table.domNode!.querySelectorAll('.mu-table-cell-selected').length;
}

// Synthesise a clipboard event whose `setData` we can inspect.
function dispatchCopy(muya: Muya, type: 'copy' | 'cut') {
    const store = new Map<string, string>();
    const clipboardData = {
        setData: (fmt: string, value: string) => store.set(fmt, value),
        getData: (fmt: string) => store.get(fmt) ?? '',
    };
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
        clipboardData: typeof clipboardData;
    };
    event.clipboardData = clipboardData;
    muya.domNode.dispatchEvent(event);
    return store;
}

describe('cross-cell table selection — highlight', () => {
    it('highlights the dragged rectangle of cells', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        dragSelect(table, 0, 0, 1, 1); // 2x2 rectangle => 4 cells
        expect(selectedCount(table)).toBe(4);
        expect(muya.editor.selection.table.hasSelection).toBe(true);
    });

    it('keeps the table selection exclusive of any text selection', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        dragSelect(table, 0, 0, 1, 1);
        // The rectangle is the only selection: no model-level text caret and
        // no native range survive alongside it.
        expect(muya.editor.selection.table.hasSelection).toBe(true);
        expect(muya.editor.activeContentBlock).toBe(null);
        expect(document.getSelection()?.rangeCount).toBe(0);
    });

    it('does not start a selection when the pointer stays in one cell', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        firePointer(cellDom(table, 0, 0), 'pointerdown');
        firePointer(cellDom(table, 0, 0), 'pointerup');
        expect(selectedCount(table)).toBe(0);
        expect(muya.editor.selection.table.hasSelection).toBe(false);
    });

    it('clears the previous selection on a new pointerdown', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        dragSelect(table, 0, 0, 1, 1);
        expect(selectedCount(table)).toBe(4);
        firePointer(cellDom(table, 2, 2), 'pointerdown');
        expect(selectedCount(table)).toBe(0);
    });

    it('cancels the selection when the pointer is released outside the table', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        // Start a drag inside the table, then move/release outside it.
        firePointer(cellDom(table, 0, 0), 'pointerdown');
        firePointer(cellDom(table, 0, 1), 'pointermove'); // selection arms + highlights
        expect(selectedCount(table)).toBeGreaterThan(0);
        firePointer(muya.domNode, 'pointermove'); // pointer leaves the table
        firePointer(muya.domNode, 'pointerup'); // released outside
        // Nothing frozen, no leftover highlight, no 1x1 anchor selection.
        expect(selectedCount(table)).toBe(0);
        expect(muya.editor.selection.table.hasSelection).toBe(false);
    });

    it('lets a browser-cancelled drag (pointercancel) end it like a release', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        firePointer(cellDom(table, 0, 0), 'pointerdown');
        firePointer(cellDom(table, 0, 1), 'pointermove');
        firePointer(cellDom(table, 0, 1), 'pointercancel');
        // Selecting had begun, so the rectangle freezes as on a release.
        expect(selectedCount(table)).toBe(2);
        firePointer(cellDom(table, 1, 1), 'pointermove');
        expect(selectedCount(table)).toBe(2);
    });

    it('never drag-selects with a finger, which scrolls instead', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        firePointer(cellDom(table, 0, 0), 'pointerdown', 'touch');
        firePointer(cellDom(table, 1, 1), 'pointermove', 'touch');
        firePointer(cellDom(table, 1, 1), 'pointerup', 'touch');
        expect(selectedCount(table)).toBe(0);
        expect(muya.editor.selection.table.hasSelection).toBe(false);
    });

    it('follows a native range across cells without dropping it', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        const anchorCell = table.cellAt(0, 0) as TableBodyCell;
        const focusCell = table.cellAt(1, 2) as TableBodyCell;
        const range = document.createRange();
        range.setStart(cellDom(table, 0, 0).firstChild!, 1);
        range.setEnd(cellDom(table, 1, 2).firstChild!, 1);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);

        muya.editor.selection.table.followCellRange(anchorCell, focusCell);

        expect(selectedCount(table)).toBe(6);
        expect(muya.editor.selection.table.followsNativeRange).toBe(true);
        expect(document.getSelection()!.rangeCount).toBe(1);
        // Resizing keeps following; a new press drops it.
        muya.editor.selection.table.followCellRange(anchorCell, table.cellAt(0, 1) as TableBodyCell);
        expect(selectedCount(table)).toBe(2);
        firePointer(cellDom(table, 2, 2), 'pointerdown', 'touch');
        expect(selectedCount(table)).toBe(0);
        expect(muya.editor.selection.table.followsNativeRange).toBe(false);
    });
});

describe('cross-cell table selection — copy', () => {
    it('copies a multi-cell rectangle as GFM table markdown', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        dragSelect(table, 0, 0, 1, 1);

        const store = dispatchCopy(muya, 'copy');
        const text = store.get('text/plain')!;
        // a1/b1 header row + a2/b2 body row, serialised as a table.
        expect(text).toContain('a1');
        expect(text).toContain('b1');
        expect(text).toContain('a2');
        expect(text).toContain('b2');
        expect(text).not.toContain('c1'); // the un-selected column is excluded
        expect(text).not.toContain('a3'); // the un-selected row is excluded
        // It is a real GFM table (header separator present).
        expect(text).toMatch(/\|\s*-+/);
    });

    it('copies a single selected cell as plain text (no table, no html)', () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        // A genuine 1x1 selection: start the drag on a2, move onto a neighbour
        // (so selecting begins), then shrink the focus back to the anchor cell.
        firePointer(cellDom(table, 1, 0), 'pointerdown');
        firePointer(cellDom(table, 1, 1), 'pointermove'); // starts selecting
        firePointer(cellDom(table, 1, 0), 'pointermove'); // shrink back to anchor
        firePointer(cellDom(table, 1, 0), 'pointerup');

        const store = dispatchCopy(muya, 'copy');
        expect(store.get('text/plain')).toBe('a2');
        expect(store.get('text/html')).toBe('');
    });
});

describe('cross-cell table selection — cut', () => {
    it('empties only the selected cells, leaving the rest intact', async () => {
        const muya = bootMuya(TABLE_MD);
        const table = firstTable(muya);
        dragSelect(table, 0, 0, 1, 1);

        dispatchCopy(muya, 'cut');

        await vi.waitFor(() => {
            const md = muya.getMarkdown();
            // The selected cells (a1/b1/a2/b2) are cleared; the others survive.
            expect(md).not.toMatch(/\ba1\b/);
            expect(md).not.toMatch(/\bb2\b/);
            expect(md).toContain('c1');
            expect(md).toContain('a3');
        });
        expect(muya.editor.selection.table.hasSelection).toBe(false);
    });
});
