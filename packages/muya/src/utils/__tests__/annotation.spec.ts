// @vitest-environment happy-dom

import type { Muya as TMuya } from '../../muya';
import type { TState } from '../../state/types';
import type { ICheckableBlock, TAnnotationPart } from '../annotation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MUYA_DEFAULT_OPTIONS } from '../../config';
import InlineRenderer from '../../inlineRenderer';
import { registerInlineSyntax } from '../../inlineRenderer/customSyntax';
import { Muya } from '../../muya';
import { getCheckableBlocks } from '../annotation';

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
});

function bootMuya(markdown: string, options: Partial<ConstructorParameters<typeof Muya>[1]> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown, ...options } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

function joined(parts: TAnnotationPart[]) {
    return parts.map(part => ('text' in part ? part.text : part.markup)).join('');
}

function annotationOf(markdown: string, options: Partial<ConstructorParameters<typeof Muya>[1]> = {}) {
    return bootMuya(markdown, options).getCheckableBlocks()[0].annotation;
}

const FIXTURE = [
    '---',
    'title: front',
    '---',
    '',
    '# Heading with **bold** and `code` #',
    '',
    'Setext *title*',
    '===',
    '',
    'Some **bold**, _italic_, ~~strike~~ and ***both*** text.',
    'A [link](http://x.com "Title") and [ref link][ref] and ![img](a.png) and ![alt][ref] here.',
    'Inline `code`, math $x^2$ and \\(y\\), emoji :smile:, <b>html</b> <kbd>Ctrl</kbd> <br>.',
    'Escapes \\* and \\_ and &amp; entity, footnote[^1], <http://auto.link> www.example.com.',
    'Hard break  ',
    'next line\\',
    'last H~2~O and 2^10^ <!-- note --> [x][missing].',
    '',
    '[ref]: http://ref.com "Ref"',
    '',
    '| a | b \\| c |',
    '| --- | --- |',
    '| x \\| y | **teh** `a\\|b` |',
    '',
    '- item one',
    '- [ ] task two',
    '',
    '> quote text',
    '',
    '***',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '$$',
    'x = 1',
    '$$',
    '',
    '```mermaid',
    'graph TD',
    '```',
    '',
    '<div>block html</div>',
    '',
    '[^1]: Footnote text.',
    '',
].join('\n');

const FIXTURE_OPTIONS = { footnote: true, texMathSingleBackslash: true };

describe('getCheckableBlocks', () => {
    it('annotations join back to the exact block text, and paths address those blocks', () => {
        const muya = bootMuya(FIXTURE, FIXTURE_OPTIONS);
        const blocks = muya.getCheckableBlocks();

        expect(blocks.map(block => block.blockName)).toEqual([
            'atxheading.content',
            'setextheading.content',
            'paragraph.content',
            'table.cell.content',
            'table.cell.content',
            'table.cell.content',
            'table.cell.content',
            'paragraph.content',
            'paragraph.content',
            'paragraph.content',
            'paragraph.content',
        ]);
        for (const block of blocks) {
            expect(joined(block.annotation)).toBe(block.text);
            const live = muya.editor.scrollPage!.queryBlock([...block.path]);
            expect(live?.isContent() && live.text).toBe(block.text);
            expect(live?.blockName).toBe(block.blockName);
        }
    });

    it('skips front matter, code, math, diagram, html, thematic breaks and reference definitions', () => {
        const blocks = bootMuya(FIXTURE, FIXTURE_OPTIONS).getCheckableBlocks();
        const texts = blocks.map(block => block.text);
        const allText = texts.join('\n');

        for (const excluded of ['title: front', 'const x = 1', 'x = 1', 'graph TD', 'block html', '[ref]:'])
            expect(allText).not.toContain(excluded);
        expect(texts).not.toContain('***');
    });

    it('marks heading prefixes, emphasis markers, link destinations and escapes as plain markup', () => {
        expect(annotationOf('## Hi **there** [link](http://x.y "T") \\* end\n')).toEqual([
            { markup: '## ' },
            { text: 'Hi ' },
            { markup: '**' },
            { text: 'there' },
            { markup: '**' },
            { text: ' ' },
            { markup: '[' },
            { text: 'link' },
            { markup: '](http://x.y "T")' },
            { text: ' ' },
            { markup: '\\' },
            { text: '* end' },
        ]);
    });

    it('reads soft breaks as a space and hard breaks as a newline', () => {
        expect(annotationOf('one\ntwo  \nthree\n')).toEqual([
            { text: 'one' },
            { markup: '\n', interpretAs: ' ' },
            { text: 'two' },
            { markup: '  \n', interpretAs: '\n' },
            { text: 'three' },
        ]);
    });

    it('reads code, math, emoji, images, footnotes, autolinks and non-prose html as one opaque word', () => {
        const parts = annotationOf(
            'a `c` $m$ :smile: ![i](p.png) b[^1] <http://x.y> <kbd>K</kbd> &amp; <i>it</i>\n',
            { footnote: true },
        );

        expect(parts.filter(part => 'markup' in part && part.interpretAs !== undefined)).toEqual([
            { markup: '`c`', interpretAs: 'X' },
            { markup: '$m$', interpretAs: 'X' },
            { markup: ':smile:', interpretAs: 'X' },
            { markup: '![i](p.png)', interpretAs: 'X' },
            { markup: '[^1]', interpretAs: 'X' },
            { markup: '<http://x.y>', interpretAs: 'X' },
            { markup: '<kbd>K</kbd>', interpretAs: 'X' },
            { markup: '&amp;', interpretAs: '&' },
        ]);
        expect(parts.slice(-3)).toEqual([{ markup: '<i>' }, { text: 'it' }, { markup: '</i>' }]);
    });

    it('tokenizes reference links with the document labels, like the renderer', () => {
        const parts = annotationOf('[known][ref] and [unknown][nope]\n\n[ref]: http://r.example\n');

        expect(parts).toEqual([
            { markup: '[' },
            { text: 'known' },
            { markup: '][ref]' },
            { text: ' and [unknown][nope]' },
        ]);
    });

    it('treats tokens of registered custom inline syntax as opaque', () => {
        const unregister = registerInlineSyntax({
            name: 'wikilink-test',
            precedence: 'beforeEmphasis',
            match: (src) => {
                const match = /^\[\[[^\]]+\]\]/.exec(src);
                return match ? { length: match[0].length, contentStart: 2, contentEnd: match[0].length - 2, data: {} } : null;
            },
        });
        try {
            expect(annotationOf('See [[My_Note]] now\n')).toEqual([
                { text: 'See ' },
                { markup: '[[My_Note]]', interpretAs: 'X' },
                { text: ' now' },
            ]);
        }
        finally {
            unregister();
        }
    });

    it('restricts the result to the requested paths', () => {
        const muya = bootMuya(FIXTURE, FIXTURE_OPTIONS);
        const all = muya.getCheckableBlocks();
        const cell = all.find(block => block.text === '**teh** `a|b`')!;

        const picked = muya.getCheckableBlocks([cell.path, [4, 'text'], [99, 'text'], ['bogus']]);

        expect(picked).toEqual([cell]);
    });

    it('sees edits still queued for the next frame', () => {
        const muya = bootMuya('first\n\nsecond\n');
        const block = muya.editor.scrollPage!.queryBlock([1, 'text'])!;
        if (!block.isContent())
            throw new Error('expected a content block');

        block.text = 'second edited';

        expect(muya.getCheckableBlocks().map(b => b.text)).toEqual(['first', 'second edited']);
    });
});

describe('getCheckableBlocks on large documents', () => {
    // A real editor would spend its time booting; the extraction itself only
    // needs the json state and the tokenizer.
    function fakeMuya(state: TState[]): TMuya {
        const muya = {
            options: { ...MUYA_DEFAULT_OPTIONS },
            editor: {
                jsonState: { flush: () => {}, getState: () => state },
            },
        } as unknown as TMuya & { editor: { inlineRenderer: InlineRenderer } };
        muya.editor.inlineRenderer = new InlineRenderer(muya);

        return muya;
    }

    it('extracts 5k paragraphs and a 5k-item list in well under a second each', () => {
        const paragraphs: TState[] = Array.from({ length: 5000 }, (_, i) => ({
            name: 'paragraph',
            text: `Paragraph ${i} with **bold**, a [link](http://x/${i}) and \`code\`.`,
        }));
        const list: TState[] = [{
            name: 'bullet-list',
            meta: { marker: '-', loose: false },
            children: Array.from({ length: 5000 }, (_, i) => ({
                name: 'list-item',
                children: [{ name: 'paragraph', text: `item ${i}` }],
            })),
        } as TState];

        for (const state of [paragraphs, list]) {
            const started = performance.now();
            const blocks: ICheckableBlock[] = getCheckableBlocks(fakeMuya(state));
            const elapsed = performance.now() - started;

            expect(blocks).toHaveLength(5000);
            expect(elapsed).toBeLessThan(1000);
        }
        const last = getCheckableBlocks(fakeMuya(list)).at(-1)!;
        expect(last.path).toEqual([0, 'children', 4999, 'children', 0, 'text']);
    });
});
