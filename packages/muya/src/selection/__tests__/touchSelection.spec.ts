// @vitest-environment happy-dom

import type Table from '../../block/gfm/table';
import type TableBodyCell from '../../block/gfm/table/cell';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// A finger selects text with a long-press and the system handles; Chromium
// reports that only as `selectionchange` (no pointer moves, no click). These
// tests pin how TextSelection adopts such a selection, and that the mouse
// drag-select path still runs on pointer events.

const bootedHosts: HTMLElement[] = [];
let hadVersion = false;
let originalVersion: string | undefined;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function textNodeOf(element: Element): Text {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode() as Text;
}

function contentDoms(muya: Muya): HTMLElement[] {
    return [...muya.domNode.querySelectorAll<HTMLElement>('.mu-paragraph-content')];
}

function selectNative(startNode: Node, startOffset: number, endNode: Node, endOffset: number): void {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
    document.dispatchEvent(new Event('selectionchange'));
}

function press(target: EventTarget, pointerType: string): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType, button: 0 }));
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function record(muya: Muya, event: string): unknown[] {
    const payloads: unknown[] = [];
    muya.eventCenter.on(event, (payload: unknown) => payloads.push(payload));
    return payloads;
}

describe('touch selection sync', () => {
    it('adopts a long-press selection and opens the format toolbar for it', async () => {
        const muya = bootMuya('alpha beta gamma\n');
        const picker = record(muya, 'muya-format-picker');
        const [content] = contentDoms(muya);
        const text = textNodeOf(content);

        press(content, 'touch');
        selectNative(text, 6, text, 10);
        await nextFrame();

        const { selection } = muya.editor;
        expect(selection.anchor?.offset).toBe(6);
        expect(selection.focus?.offset).toBe(10);
        expect(selection.anchorBlock?.domNode).toBe(content);
        expect(muya.editor.activeContentBlock?.domNode).toBe(content);
        expect(picker).toHaveLength(1);
        // Placed below the selection, clear of the system Cut/Copy bar.
        expect(picker[0]).toMatchObject({ block: selection.anchorBlock, touch: true });
        // The native range is read, never rewritten: the handles stay up.
        expect(document.getSelection()!.toString()).toBe('beta');
    });

    it('leaves mouse selections to the click/keyup handlers', async () => {
        const muya = bootMuya('alpha beta gamma\n');
        const picker = record(muya, 'muya-format-picker');
        const [content] = contentDoms(muya);
        const text = textNodeOf(content);

        press(content, 'mouse');
        selectNative(text, 6, text, 10);
        await nextFrame();

        expect(picker).toHaveLength(0);
    });

    it('hides the format toolbar once a touch selection collapses', async () => {
        const muya = bootMuya('alpha beta gamma\n');
        const picker = record(muya, 'muya-format-picker');
        const [content] = contentDoms(muya);
        const text = textNodeOf(content);

        press(content, 'touch');
        selectNative(text, 6, text, 10);
        await nextFrame();
        selectNative(text, 8, text, 8);
        await nextFrame();

        expect(picker.at(-1)).toEqual({ reference: null });
    });

    it('records a selection spanning blocks without a format toolbar', async () => {
        const muya = bootMuya('alpha beta\n\ngamma delta\n');
        const picker = record(muya, 'muya-format-picker');
        const [first, second] = contentDoms(muya);

        press(first, 'touch');
        selectNative(textNodeOf(first), 2, textNodeOf(second), 3);
        await nextFrame();

        const { selection } = muya.editor;
        expect(selection.anchorBlock?.domNode).toBe(first);
        expect(selection.focusBlock?.domNode).toBe(second);
        expect(muya.editor.activeContentBlock).toBeNull();
        expect(picker).toHaveLength(0);
    });

    it('turns a range dragged across table cells into a cell rectangle', async () => {
        const muya = bootMuya('| a1 | b1 |\n| --- | --- |\n| a2 | b2 |\n');
        const table = muya.editor.scrollPage!.firstContentInDescendant()!.closestBlock('table') as Table;
        const cellText = (row: number, column: number) =>
            textNodeOf((table.cellAt(row, column) as TableBodyCell).domNode!);

        press(muya.domNode, 'touch');
        selectNative(cellText(0, 0), 1, cellText(1, 1), 1);
        await nextFrame();

        expect(muya.editor.selection.table.followsNativeRange).toBe(true);
        expect(table.domNode!.querySelectorAll('.mu-table-cell-selected')).toHaveLength(4);
        expect(document.getSelection()!.rangeCount).toBe(1);

        // Pulling the handle back into the anchor cell drops the rectangle.
        selectNative(cellText(0, 0), 0, cellText(0, 0), 2);
        await nextFrame();
        expect(muya.editor.selection.table.hasSelection).toBe(false);
    });
});

describe('mouse drag-select on pointer events', () => {
    it('commits a selection dragged across blocks on pointerup', () => {
        const muya = bootMuya('alpha beta\n\ngamma delta\n');
        const [first, second] = contentDoms(muya);

        press(first, 'mouse');
        document.getSelection()!.setBaseAndExtent(textNodeOf(first), 1, textNodeOf(second), 4);
        second.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
        second.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));

        const { selection } = muya.editor;
        expect(selection.anchorBlock?.domNode).toBe(first);
        expect(selection.anchor?.offset).toBe(1);
        expect(selection.focusBlock?.domNode).toBe(second);
        expect(selection.focus?.offset).toBe(4);
    });

    it('does not treat a finger drag as a selection drag', () => {
        const muya = bootMuya('alpha beta\n\ngamma delta\n');
        const [first, second] = contentDoms(muya);

        press(first, 'touch');
        document.getSelection()!.setBaseAndExtent(textNodeOf(first), 1, textNodeOf(second), 4);
        second.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
        second.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));

        expect(muya.editor.selection.focusBlock?.domNode).not.toBe(second);
    });
});
