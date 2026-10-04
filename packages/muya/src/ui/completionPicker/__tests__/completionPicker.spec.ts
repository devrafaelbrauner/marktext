// @vitest-environment happy-dom

import type Format from '../../../block/base/format';
import type { ICompletionItem, ICompletionProvider } from '../../../completion';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCompletionActive, registerCompletionProvider } from '../../../completion';
import { Muya } from '../../../muya';
import { CompletionPicker } from '../index';

let disposers: (() => void)[] = [];
const muyas: Muya[] = [];

function use(provider: ICompletionProvider) {
    disposers.push(registerCompletionProvider(provider));
}

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    muyas.push(muya);

    return muya;
}

function paragraph(muya: Muya) {
    return muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
}

// Types `raw` into the paragraph with the caret at `caret`, the way a
// keystroke reaches `Format.inputHandler`.
function typeInto(muya: Muya, raw: string, caret: number) {
    const block = paragraph(muya);
    block.domNode!.textContent = raw;
    block.setCursor(caret, caret);
    block.inputHandler(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: raw[caret - 1] }));

    return block;
}

function picker(muya: Muya) {
    return (muya as unknown as { _uiPlugins: Record<string, CompletionPicker> })._uiPlugins.completionPicker;
}

function pressKey(muya: Muya, key: string) {
    muya.domNode.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const wikilinks: ICompletionProvider = {
    id: 'wikilinks',
    trigger: /\[\[([^\]]*)$/,
    consumeAfter: /^\]\]/,
    getItems: query => [
        { label: `${query}-one`, insertText: '[[Note One]]', caretOffset: 10 },
        { label: 'two', detail: 'folder', insertText: '[[Two]]' },
    ],
};

beforeAll(() => {
    Muya.use(CompletionPicker);
});

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0);

        return 0;
    });
});

afterEach(() => {
    while (muyas.length)
        muyas.pop()!.destroy();
    disposers.forEach(dispose => dispose());
    disposers = [];
    vi.restoreAllMocks();
    document.getSelection()?.removeAllRanges();
});

describe('completion picker', () => {
    it('opens on a trigger and inserts over the match plus consumeAfter, caret at caretOffset, one undo step', () => {
        use(wikilinks);
        const muya = boot('x');
        const block = typeInto(muya, 'see [[no]] end', 8);
        muya.flush();

        const list = picker(muya);
        expect(list.status).toBe(true);
        expect(list.renderArray.map(i => i.label)).toEqual(['no-one', 'two']);
        expect(list.floatBox!.querySelector('li.item.active')?.textContent).toBe('no-one');

        pressKey(muya, 'Enter');

        expect(block.text).toBe('see [[Note One]] end');
        expect(block.getCursor()!.start.offset).toBe(4 + 10);
        expect(list.status).toBe(false);
        expect(isCompletionActive(muya)).toBe(false);

        muya.undo();
        expect(paragraph(muya).text).toBe('see [[no]] end');
    });

    it('moves with arrow keys and inserts the clicked item', () => {
        use(wikilinks);
        const muya = boot('x');
        const block = typeInto(muya, '[[t', 3);
        const list = picker(muya);

        pressKey(muya, 'ArrowDown');
        expect(list.activeItem?.label).toBe('two');
        pressKey(muya, 'ArrowUp');
        expect(list.activeItem?.label).toBe('t-one');

        list.floatBox!.querySelectorAll<HTMLElement>('li.item')[1].click();
        expect(block.text).toBe('[[Two]]');
        expect(block.getCursor()!.start.offset).toBe(7);
    });

    it('escape dismisses the list until the text changes', () => {
        use(wikilinks);
        const muya = boot('x');
        typeInto(muya, '[[a', 3);
        const list = picker(muya);
        expect(list.status).toBe(true);

        pressKey(muya, 'Escape');
        expect(list.status).toBe(false);
        expect(isCompletionActive(muya)).toBe(false);

        muya.eventCenter.emit('muya-completion', { block: paragraph(muya), anchor: 3, focus: 3 });
        expect(list.status).toBe(false);

        typeInto(muya, '[[ab', 4);
        expect(list.status).toBe(true);
    });

    it('drops async results superseded by a newer query', async () => {
        const pending: { query: string; resolve: (items: ICompletionItem[]) => void }[] = [];
        use({
            id: 'slow',
            trigger: /#(\w*)$/,
            getItems: query => new Promise((resolve) => {
                pending.push({ query, resolve });
            }),
        });
        const muya = boot('x');
        typeInto(muya, '#a', 2);
        typeInto(muya, '#ab', 3);
        const list = picker(muya);

        pending[1].resolve([{ label: 'fresh', insertText: '#abc' }]);
        await Promise.resolve();
        pending[0].resolve([{ label: 'stale', insertText: '#a' }]);
        await Promise.resolve();

        expect(pending.map(p => p.query)).toEqual(['a', 'ab']);
        expect(list.renderArray.map(i => i.label)).toEqual(['fresh']);
    });

    it('only completes paragraph, heading and table-cell content with a collapsed caret', () => {
        use(wikilinks);
        const muya = boot('x');
        const list = picker(muya);
        const block = paragraph(muya);
        block.text = '[[a';

        muya.eventCenter.emit('muya-completion', { block, anchor: 1, focus: 3 });
        expect(list.status).toBe(false);

        const fake = { blockName: 'codeblock.content', text: '[[a' } as unknown as Format;
        muya.eventCenter.emit('muya-completion', { block: fake, anchor: 3, focus: 3 });
        expect(list.status).toBe(false);
    });

    it('keeps the emoji picker closed while a provider claims the text before the caret', () => {
        const muya = boot('x');
        const emoji = vi.fn();
        muya.eventCenter.on('muya-emoji-picker', emoji);

        typeInto(muya, ':lucide-ho:', 10);
        expect(emoji).toHaveBeenLastCalledWith(expect.objectContaining({ emojiText: 'lucide-ho' }));

        use({ id: 'icons', trigger: /:lucide-([a-z-]*)$/, getItems: () => [{ label: 'house', insertText: ':lucide-house:' }] });
        emoji.mockClear();
        typeInto(muya, ':lucide-hou:', 11);
        expect(isCompletionActive(muya)).toBe(true);
        expect(emoji.mock.calls.every(([payload]) => payload.emojiText === '')).toBe(true);
    });
});
