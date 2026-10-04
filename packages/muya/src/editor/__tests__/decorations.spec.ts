// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import type { IHighlightDecoration } from '../../inlineRenderer/types';
import type { IDecorationClickPayload, IDecorationRange } from '../decorations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import { getTextContent } from '../../selection/dom';
import { mergeHighlightSegments } from '../decorations';

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
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function contentAt(muya: Muya, path: (string | number)[]): Content {
    const block = muya.editor.scrollPage!.queryBlock([...path]);
    if (!block || !block.isContent())
        throw new Error(`no content block at ${JSON.stringify(path)}`);

    return block;
}

function decorated(root: Element | Muya, layerId?: string): HTMLElement[] {
    const node = root instanceof Muya ? root.domNode : root;
    const selector = layerId == null ? '[data-mu-decoration-layer]' : `[data-mu-decoration-layer="${layerId}"]`;

    return [...node.querySelectorAll<HTMLElement>(selector)];
}

function range(path: (string | number)[], start: number, end: number, className = 'mu-decoration-spelling', data?: Record<string, string>): IDecorationRange {
    return data ? { path, start, end, className, data } : { path, start, end, className };
}

const P0 = [0, 'text'];
const P1 = [1, 'text'];

describe('mergeHighlightSegments', () => {
    const deco = (layerId: string, index = 0): IHighlightDecoration => ({ layerId, index, className: layerId });

    it('splits overlapping decorations into sorted, disjoint segments nested widest first', () => {
        const wide = deco('wide');
        const narrow = deco('narrow');
        const segments = mergeHighlightSegments(20, [], [
            { start: 4, end: 8, decoration: narrow },
            { start: 0, end: 10, decoration: wide },
        ]);

        expect(segments).toEqual([
            { start: 0, end: 4, active: undefined, decorationOnly: true, decorations: [wide] },
            { start: 4, end: 8, active: undefined, decorationOnly: true, decorations: [wide, narrow] },
            { start: 8, end: 10, active: undefined, decorationOnly: true, decorations: [wide] },
        ]);
    });

    it('keeps touching search matches apart and lets the active match win an overlap', () => {
        const segments = mergeHighlightSegments(10, [
            { start: 0, end: 2, active: false },
            { start: 2, end: 4, active: false },
            { start: 3, end: 6, active: true },
        ], []);

        expect(segments).toEqual([
            { start: 0, end: 2, active: false },
            { start: 2, end: 3, active: false },
            { start: 3, end: 4, active: true },
            { start: 4, end: 6, active: true },
        ]);
    });

    it('clamps to the text and drops empty or inverted ranges', () => {
        const d = deco('d');
        const segments = mergeHighlightSegments(5, [{ start: 3, end: 3, active: true }], [
            { start: -4, end: 99, decoration: d },
            { start: 4, end: 2, decoration: deco('inverted') },
        ]);

        expect(segments).toEqual([{ start: 0, end: 5, active: undefined, decorationOnly: true, decorations: [d] }]);
    });
});

describe('decorations', () => {
    it('are render-only: no json-change, no history entry, no markdown or state change', () => {
        const muya = bootMuya('Hello world\n\nSecond line\n');
        const markdown = muya.getMarkdown();
        const state = muya.getState();
        const history = JSON.stringify(muya.getHistory());
        const onChange = vi.fn();
        muya.on('json-change', onChange);

        muya.setDecorations('spell', [range(P0, 0, 5, 'mu-decoration-spelling', { rule: 'MORFOLOGIK' })]);
        muya.editor.jsonState.flush();

        expect(decorated(muya).map(el => el.textContent)).toEqual(['Hello']);
        expect(onChange).not.toHaveBeenCalled();
        expect(muya.getMarkdown()).toBe(markdown);
        expect(muya.getState()).toEqual(state);
        expect(JSON.stringify(muya.getHistory())).toBe(history);

        muya.clearDecorations();
        expect(onChange).not.toHaveBeenCalled();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('never duplicate text when they overlap each other and a search match', () => {
        const muya = bootMuya('Hello **bold** world and more\n');
        const block = contentAt(muya, P0);
        muya.search('o');
        muya.setDecorations('a', [range(P0, 1, 12, 'deco-a'), range(P0, 8, 17, 'deco-b')]);
        muya.setDecorations('b', [range(P0, 0, 29, 'deco-c'), range(P0, 3, 5, 'deco-d')]);

        const { domNode } = block;
        expect(domNode!.textContent).toBe(block.text);
        // What `Format.inputHandler` writes back into the document.
        expect(getTextContent(domNode!, [CLASS_NAMES.MU_MATH_RENDER, CLASS_NAMES.MU_RUBY_RENDER])).toBe(block.text);
        expect(domNode!.querySelectorAll(`.${CLASS_NAMES.MU_HIGHLIGHT}, .${CLASS_NAMES.MU_SELECTION}`).length).toBeGreaterThan(0);
        expect(decorated(domNode!, 'b').length).toBeGreaterThan(0);
    });

    it('paint the class names and data attributes of the range, never the search box style', () => {
        const muya = bootMuya('Hello world\n');
        muya.setDecorations('grammar', [range(P0, 6, 11, 'mu-decoration-grammar my-extra', {
            'ruleId': 'R1',
            'message': 'a "quoted" <b>',
            'bad key!': 'x',
        })]);

        const [span] = decorated(muya, 'grammar');
        expect(span.textContent).toBe('world');
        expect([...span.classList]).toEqual(expect.arrayContaining(['mu-decoration-grammar', 'my-extra', CLASS_NAMES.MU_DECORATION]));
        expect(span.getAttribute('data-ruleid')).toBe('R1');
        expect(span.getAttribute('data-message')).toBe('a "quoted" <b>');
        expect([...span.attributes].map(attr => attr.name).filter(name => name.startsWith('data-bad'))).toEqual([]);
        expect(span.closest(`.${CLASS_NAMES.MU_HIGHLIGHT}, .${CLASS_NAMES.MU_SELECTION}`)).toBeNull();
    });

    it('survive re-renders that keep the text, including a full tree rebuild', () => {
        const muya = bootMuya('Hello world\n\nSecond line\n');
        muya.setDecorations('spell', [range(P0, 0, 5)]);

        contentAt(muya, P0).update();
        expect(decorated(muya).length).toBe(1);

        contentAt(muya, P0).setCursor(2, 2, true);
        expect(decorated(muya).length).toBe(1);

        const before = contentAt(muya, P0);
        muya.setOptions({ fontSize: 18 }, true);
        const after = contentAt(muya, P0);
        expect(after).not.toBe(before);
        expect(decorated(after.domNode!).map(el => el.textContent)).toEqual(['Hello']);
    });

    it('drop every layer of a block whose text changes and keep the other blocks', () => {
        const muya = bootMuya('Hello world\n\nSecond line\n');
        muya.setDecorations('spell', [range(P0, 0, 5), range(P1, 0, 6)]);
        muya.setDecorations('grammar', [range(P0, 6, 11, 'mu-decoration-grammar')]);

        const block = contentAt(muya, P0);
        block.text = 'Hello there';
        block.update();

        expect(decorated(block.domNode!)).toEqual([]);
        expect(decorated(contentAt(muya, P1).domNode!).length).toBe(1);

        block.text = 'Hello world';
        block.update();
        expect(decorated(block.domNode!)).toEqual([]);
    });

    it('drop and unstyle the spans when typing changes the text without a re-render', () => {
        const muya = bootMuya('Hello world\n');
        muya.setDecorations('spell', [range(P0, 0, 5)]);
        const block = contentAt(muya, P0);
        const [span] = decorated(muya);

        (span.firstChild as Text).data = 'Hellox';
        block.setCursor(6, 6);
        muya.domNode.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));

        expect(block.text).toBe('Hellox world');
        expect(decorated(muya)).toEqual([]);
        block.update();
        expect(decorated(muya)).toEqual([]);
    });

    it('wait for an IME composition in the active block to end before repainting it', () => {
        const muya = bootMuya('Hello world\n\nSecond line\n');
        const active = contentAt(muya, P0);
        active.setCursor(2, 2);

        muya.domNode.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        muya.setDecorations('spell', [range(P0, 0, 5), range(P1, 0, 6)]);

        expect(decorated(active.domNode!)).toEqual([]);
        expect(decorated(contentAt(muya, P1).domNode!).length).toBe(1);

        muya.domNode.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));

        expect(decorated(active.domNode!).map(el => el.textContent)).toEqual(['Hello']);
    });

    it('ignore unresolvable paths, non-inline blocks, and empty or inverted ranges; clamp to the text', () => {
        const muya = bootMuya('Hello\n\n```js\ncode\n```\n');
        muya.setDecorations('spell', [
            range([42, 'text'], 0, 3),
            range(['bogus'], 0, 3),
            range([0], 0, 3),
            range([1, 'text'], 0, 3),
            range(P0, 2, 2),
            range(P0, 4, 1),
            range(P0, Number.NaN, 3),
        ]);
        expect(decorated(muya)).toEqual([]);

        muya.setDecorations('spell', [range(P0, -10, 999)]);
        expect(decorated(muya).map(el => el.textContent)).toEqual(['Hello']);
    });

    it('re-render only the blocks whose ranges changed', () => {
        const muya = bootMuya('one\n\ntwo\n\nthree\n');
        const blocks = [P0, P1, [2, 'text']].map(path => contentAt(muya, path));
        const spies = blocks.map(block => vi.spyOn(block, 'update'));
        const touched = () => blocks.filter((_, i) => spies[i].mock.calls.length > 0).map(block => block.text);
        const reset = () => spies.forEach(spy => spy.mockClear());

        muya.setDecorations('spell', [range(P1, 0, 3)]);
        expect(touched()).toEqual(['two']);

        reset();
        muya.setDecorations('spell', [range(P1, 0, 3)]);
        expect(touched()).toEqual([]);

        reset();
        muya.setDecorations('spell', [range(P1, 0, 3), range([2, 'text'], 0, 5)]);
        expect(touched()).toEqual(['three']);

        reset();
        muya.clearDecorations('other');
        expect(touched()).toEqual([]);

        muya.clearDecorations('spell');
        expect(touched()).toEqual(['two', 'three']);
        expect(decorated(muya)).toEqual([]);
    });

    it('keep the search highlights of a block they re-render', () => {
        const muya = bootMuya('find the needle here\n');
        muya.search('needle');
        muya.setDecorations('spell', [range(P0, 0, 4)]);

        expect(muya.domNode.querySelector(`.${CLASS_NAMES.MU_HIGHLIGHT}`)?.textContent).toBe('needle');
        expect(decorated(muya).map(el => el.textContent)).toEqual(['find']);
    });

    it('emit decoration-click with the range, data and rect of a plain primary click', () => {
        const muya = bootMuya('Intro\n\nHello world\n');
        muya.setDecorations('a', [range(P1, 0, 11, 'mu-decoration-style')]);
        muya.setDecorations('b', [range(P1, 6, 11, 'mu-decoration-grammar', { id: '7' })]);
        const onClick = vi.fn<(payload: IDecorationClickPayload) => void>();
        muya.on('decoration-click', onClick);

        const inner = decorated(muya, 'b')[0];
        inner.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }));
        inner.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 2 }));
        expect(onClick).not.toHaveBeenCalled();

        const event = new MouseEvent('click', { bubbles: true, button: 0 });
        inner.dispatchEvent(event);

        expect(onClick).toHaveBeenCalledTimes(1);
        const payload = onClick.mock.calls[0][0];
        expect(payload.layerId).toBe('b');
        expect(payload.range).toEqual({ path: P1, start: 6, end: 11, className: 'mu-decoration-grammar', data: { id: '7' } });
        expect(payload.event).toBe(event);
        expect(typeof payload.rect.top).toBe('number');
    });

    it('report the current path of a block that moved since the decoration was set', () => {
        const muya = bootMuya('Hello world\n');
        muya.setDecorations('spell', [range(P0, 0, 5)]);
        muya.setOptions({ fontSize: 18 }, true);
        const onClick = vi.fn<(payload: IDecorationClickPayload) => void>();
        muya.on('decoration-click', onClick);

        decorated(muya)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

        expect(onClick.mock.calls[0][0].range.path).toEqual(P0);
    });

    it('are cleared by setContent, which then emits content-set', () => {
        const muya = bootMuya('Hello world\n');
        muya.setDecorations('spell', [range(P0, 0, 5)]);
        const onSet = vi.fn(() => muya.getMarkdown());
        muya.on('content-set', onSet);

        muya.setContent('Hello world\n');

        expect(onSet).toHaveBeenCalledTimes(1);
        expect(onSet.mock.results[0].value).toBe('Hello world\n');
        expect(decorated(muya)).toEqual([]);
        contentAt(muya, P0).update();
        expect(decorated(muya)).toEqual([]);
    });
});

describe('replaceRange', () => {
    const MARKDOWN = '# Title here\n\nSome text with teh typo.\n\n| a | b |\n| --- | --- |\n| x \\| y | teh |\n';
    const CELL = [2, 'children', 1, 'children', 1, 'text'];
    const ESCAPED_CELL = [2, 'children', 1, 'children', 0, 'text'];

    it('refuses an edit whose expected text no longer matches, changing nothing', () => {
        const muya = bootMuya(MARKDOWN);
        const markdown = muya.getMarkdown();
        const onChange = vi.fn();
        muya.on('json-change', onChange);

        expect(muya.replaceRange({ path: P1, start: 15, end: 18, expected: 'the', replacement: 'x' })).toBe(false);
        expect(muya.replaceRange({ path: P1, start: 30, end: 40, expected: '', replacement: 'x' })).toBe(false);
        expect(muya.replaceRange({ path: [9, 'text'], start: 0, end: 0, expected: '', replacement: 'x' })).toBe(false);
        muya.editor.jsonState.flush();

        expect(onChange).not.toHaveBeenCalled();
        expect(muya.getMarkdown()).toBe(markdown);
    });

    it('applies the edit, puts the caret after it and fires json-change', () => {
        const muya = bootMuya(MARKDOWN);
        const onChange = vi.fn();
        muya.on('json-change', onChange);

        expect(muya.replaceRange({ path: P1, start: 15, end: 18, expected: 'teh', replacement: 'the' })).toBe(true);

        expect(contentAt(muya, P1).text).toBe('Some text with the typo.');
        expect(muya.getMarkdown()).toContain('Some text with the typo.');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].source).toBe('user');
        const selection = muya.getSelection()!;
        expect(selection.anchor.offset).toBe(18);
        expect(selection.focus.offset).toBe(18);
    });

    it('is undone in one step, apart from an edit queued just before it', async () => {
        const muya = bootMuya(MARKDOWN);
        const block = contentAt(muya, P1);
        block.text = 'Some text with teh typo!';

        expect(muya.replaceRange({ path: P1, start: 15, end: 18, expected: 'teh', replacement: 'the' })).toBe(true);
        expect(muya.getMarkdown()).toContain('the typo!');

        muya.undo();
        await vi.waitFor(() => expect(contentAt(muya, P1).text).toBe('Some text with teh typo!'));
        muya.undo();
        await vi.waitFor(() => expect(contentAt(muya, P1).text).toBe('Some text with teh typo.'));
    });

    it('edits headings (whose text starts with the # prefix) and table cells', () => {
        const muya = bootMuya(MARKDOWN);

        expect(muya.replaceRange({ path: P0, start: 2, end: 7, expected: 'Title', replacement: 'Heading' })).toBe(true);
        expect(muya.replaceRange({ path: CELL, start: 0, end: 3, expected: 'teh', replacement: 'the' })).toBe(true);
        const escaped = contentAt(muya, ESCAPED_CELL).text;
        const y = escaped.indexOf('y');
        expect(muya.replaceRange({ path: ESCAPED_CELL, start: y, end: y + 1, expected: 'y', replacement: 'z' })).toBe(true);

        const markdown = muya.getMarkdown();
        expect(markdown).toContain('# Heading here');
        expect(markdown).toMatch(/\| x \\\| z \| the \|/);
    });

    it('drops the decorations of the edited block', () => {
        const muya = bootMuya(MARKDOWN);
        muya.setDecorations('spell', [range(P1, 15, 18)]);

        muya.replaceRange({ path: P1, start: 15, end: 18, expected: 'teh', replacement: 'the' });

        expect(decorated(muya)).toEqual([]);
    });
});

describe('insertText', () => {
    it('replaces the selection of the last selected block as one undo step', async () => {
        const muya = bootMuya('Hello world\n');
        contentAt(muya, P0).setCursor(6, 11);

        expect(muya.insertText('there')).toBe(true);
        expect(muya.getMarkdown()).toBe('Hello there\n');
        expect(muya.getSelection()!.anchor.offset).toBe(11);

        muya.undo();
        await vi.waitFor(() => expect(muya.getMarkdown()).toBe('Hello world\n'));
    });
});
