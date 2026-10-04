// @vitest-environment happy-dom

import type CodeBlock from '../../block/commonMark/codeBlock';
import type { ICodeBlockRenderContext, ICodeBlockRenderer } from '../registry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';
import { MarkdownToHtml } from '../../state/markdownToHtml';
import { renderToStaticHTML } from '../../state/renderToStaticHTML';
import { registerCodeBlockRenderer } from '../registry';

const DOC = '```dataview js\nfoo\n```\n';

let disposers: (() => void)[] = [];
const muyas: Muya[] = [];

function use(renderer: ICodeBlockRenderer) {
    const dispose = registerCodeBlockRenderer(renderer);
    disposers.push(dispose);

    return dispose;
}

function boot(markdown = DOC): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    muyas.push(muya);
    // `CodeBlock.create` applies the language on the next animation frame.
    vi.advanceTimersByTime(20);

    return muya;
}

function codeBlockOf(muya: Muya) {
    return muya.editor.scrollPage!.children.head as unknown as CodeBlock;
}

function preview(muya: Muya) {
    return muya.domNode.querySelector<HTMLElement>('pre.mu-code-block > .mu-code-block-preview');
}

function edit(muya: Muya, text: string) {
    const content = codeBlockOf(muya).lastContentInDescendant()!;
    content.text = text;
    content.update();
}

// Recording renderer: one entry per render call.
function recorder(overrides: Partial<ICodeBlockRenderer> = {}) {
    const calls: { ctx: ICodeBlockRenderContext; cleanup: ReturnType<typeof vi.fn> }[] = [];
    const renderer: ICodeBlockRenderer = {
        lang: ['dataview'],
        render(container, ctx) {
            const cleanup = vi.fn();
            calls.push({ ctx, cleanup });
            container.textContent = `rendered:${ctx.source}`;

            return cleanup;
        },
        ...overrides,
    };

    return { renderer, calls };
}

beforeEach(() => {
    vi.useFakeTimers();
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (muyas.length)
        muyas.pop()!.destroy();
    disposers.forEach(dispose => dispose());
    disposers = [];
    vi.useRealTimers();
});

describe('registerCodeBlockRenderer', () => {
    it('rejects built-in diagram languages, non lower-case and duplicate languages', () => {
        for (const lang of ['mermaid', 'plantuml', 'vega-lite', 'flowchart', 'sequence', 'math'])
            expect(() => registerCodeBlockRenderer({ lang: [lang], render() {} })).toThrow();
        expect(() => registerCodeBlockRenderer({ lang: ['DataView'], render() {} })).toThrow();
        use({ lang: ['dataview'], render() {} });
        expect(() => registerCodeBlockRenderer({ lang: ['dataview'], render() {} })).toThrow();
    });

    it('leaves the diagram block untouched', () => {
        use({ lang: ['dataview'], render() {} });
        const muya = boot('```mermaid\ngraph TD\n```\n');
        expect(muya.editor.scrollPage!.children.head!.blockName).toBe('diagram');
        expect(muya.domNode.querySelector('.mu-code-block-preview')).toBeNull();
    });
});

describe('code block preview lifecycle', () => {
    it('attaches a non-editable preview below the code with the first info word as lang', () => {
        const { renderer, calls } = recorder();
        use(renderer);
        const muya = boot();

        const node = preview(muya)!;
        expect(node.getAttribute('contenteditable')).toBe('false');
        expect(node.textContent).toBe('rendered:foo');
        expect(calls).toHaveLength(1);
        expect(calls[0].ctx.lang).toBe('dataview');
        expect(calls[0].ctx.source).toBe('foo');
        expect(codeBlockOf(muya).getState()).toMatchObject({ name: 'code-block', meta: { lang: 'dataview js', type: 'fenced' } });
    });

    it('debounces re-renders, aborts the superseded render and runs its cleanup first', () => {
        const { renderer, calls } = recorder({ debounceMs: 100 });
        use(renderer);
        const muya = boot();

        edit(muya, 'foo1');
        vi.advanceTimersByTime(60);
        edit(muya, 'foo12');
        vi.advanceTimersByTime(99);
        expect(calls).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(calls).toHaveLength(2);
        expect(calls[1].ctx.source).toBe('foo12');
        expect(calls[0].ctx.signal.aborted).toBe(true);
        expect(calls[0].cleanup).toHaveBeenCalledTimes(1);
        expect(calls[1].ctx.signal.aborted).toBe(false);
        expect(preview(muya)!.textContent).toBe('rendered:foo12');
    });

    it('defaults to a 300 ms debounce and skips unchanged sources', () => {
        const { renderer, calls } = recorder();
        use(renderer);
        const muya = boot();

        edit(muya, 'bar');
        vi.advanceTimersByTime(299);
        expect(calls).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(calls).toHaveLength(2);

        codeBlockOf(muya).lastContentInDescendant()!.update();
        vi.advanceTimersByTime(1000);
        expect(calls).toHaveLength(2);
    });

    it('runs the cleanup of a stale async render as soon as it resolves', async () => {
        const resolvers: ((cleanup: () => void) => void)[] = [];
        const signals: AbortSignal[] = [];
        use({
            lang: ['dataview'],
            debounceMs: 0,
            render(_container, ctx) {
                signals.push(ctx.signal);

                return new Promise((resolve) => {
                    resolvers.push(resolve);
                });
            },
        });
        const muya = boot();
        edit(muya, 'next');
        vi.advanceTimersByTime(0);
        expect(signals).toHaveLength(2);
        expect(signals[0].aborted).toBe(true);

        const staleCleanup = vi.fn();
        const liveCleanup = vi.fn();
        resolvers[0](staleCleanup);
        resolvers[1](liveCleanup);
        await Promise.resolve();
        expect(staleCleanup).toHaveBeenCalledTimes(1);
        expect(liveCleanup).not.toHaveBeenCalled();

        codeBlockOf(muya).lang = 'js';
        expect(liveCleanup).toHaveBeenCalledTimes(1);
        expect(signals[1].aborted).toBe(true);
    });

    it('shows render errors as text, never as markup', async () => {
        use({
            lang: ['dataview'],
            render() {
                throw new Error('<img src=x onerror=alert(1)> bad');
            },
        });
        use({ lang: ['asyncview'], render: () => Promise.reject(new Error('<b>late</b>')) });
        const muya = boot('```dataview\nfoo\n```\n\n```asyncview\nbar\n```\n');
        await Promise.resolve();
        await Promise.resolve();

        const errors = [...muya.domNode.querySelectorAll('.mu-code-block-preview-error')];
        expect(errors.map(e => e.textContent)).toEqual(['<img src=x onerror=alert(1)> bad', '<b>late</b>']);
        expect(muya.domNode.querySelector('.mu-code-block-preview img, .mu-code-block-preview b')).toBeNull();
    });

    it('setSource replaces the code as one undoable edit and re-renders', () => {
        const { renderer, calls } = recorder({ debounceMs: 0 });
        use(renderer);
        const muya = boot();

        calls[0].ctx.setSource('bar\nbaz');
        expect(muya.getMarkdown()).toBe('```dataview js\nbar\nbaz\n```\n');
        vi.advanceTimersByTime(0);
        expect(calls[calls.length - 1].ctx.source).toBe('bar\nbaz');

        muya.undo();
        expect(muya.getMarkdown()).toBe(DOC);
        expect(codeBlockOf(muya).lastContentInDescendant()!.text).toBe('foo');
    });

    it('detaches on a language change and re-attaches when the language comes back', () => {
        const { renderer, calls } = recorder();
        use(renderer);
        const muya = boot();
        const block = codeBlockOf(muya);

        block.lang = 'python';
        expect(preview(muya)).toBeNull();
        expect(calls[0].cleanup).toHaveBeenCalledTimes(1);
        expect(calls[0].ctx.signal.aborted).toBe(true);

        block.lang = 'DataView';
        expect(preview(muya)!.textContent).toBe('rendered:foo');
        expect(calls).toHaveLength(2);
    });

    it('follows renderers registered and unregistered after construction', () => {
        const muya = boot();
        expect(preview(muya)).toBeNull();

        const { renderer, calls } = recorder();
        const dispose = use(renderer);
        expect(preview(muya)!.textContent).toBe('rendered:foo');

        dispose();
        expect(preview(muya)).toBeNull();
        expect(calls[0].cleanup).toHaveBeenCalledTimes(1);
    });

    it('cleans up when the block is removed or the editor is destroyed', async () => {
        const { renderer, calls } = recorder();
        use(renderer);
        const muya = boot();

        muya.setContent('plain paragraph');
        await Promise.resolve();
        expect(calls[0].cleanup).toHaveBeenCalledTimes(1);
        expect(calls[0].ctx.signal.aborted).toBe(true);

        const other = boot();
        other.destroy();
        expect(calls[1].cleanup).toHaveBeenCalledTimes(1);
    });

    it('keeps mouse and keyboard events inside the preview away from the editor', () => {
        use({
            lang: ['dataview'],
            render(container) {
                container.innerHTML = '<button>go</button>';
            },
        });
        const muya = boot();
        const reached = vi.fn();
        for (const type of ['mousedown', 'click', 'keydown'])
            muya.domNode.addEventListener(type, reached);

        const button = preview(muya)!.querySelector('button')!;
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(reached).not.toHaveBeenCalled();
    });
});

describe('code block export', () => {
    const md = '```dataview\nlist\n```\n\n```other\nx\n```\n';

    it('uses a synchronous exportHtml in renderToStaticHTML and keeps unclaimed blocks as code', () => {
        const baseline = renderToStaticHTML(md, { sanitize: false });
        const dispose = registerCodeBlockRenderer({
            lang: ['dataview'],
            render() {},
            exportHtml: (source, lang) => `<p class="dv">${lang}:${source.trim()}</p>`,
        });
        const html = renderToStaticHTML(md, { sanitize: false });
        dispose();

        expect(html).toContain('<div class="mu-code-block-export" data-lang="dataview"><p class="dv">dataview:list</p></div>');
        expect(html).toContain('language-other');
        expect(renderToStaticHTML(md, { sanitize: false })).toBe(baseline);
    });

    it('awaits an asynchronous exportHtml in MarkdownToHtml', async () => {
        vi.useRealTimers();
        use({
            lang: ['dataview'],
            render() {},
            exportHtml: async source => `<p class="dv">${source.trim()}</p>`,
        });
        const html = await new MarkdownToHtml(md).renderHtml();
        expect(html).toContain('<p class="dv">list</p>');
        expect(html).not.toContain('language-dataview');
    });

    it('exports as code without exportHtml', () => {
        use({ lang: ['dataview'], render() {} });
        expect(renderToStaticHTML(md, { sanitize: false })).toContain('language-dataview');
    });
});
