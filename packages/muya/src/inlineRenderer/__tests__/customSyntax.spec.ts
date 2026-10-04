// @vitest-environment happy-dom

import type Format from '../../block/base/format';
import type { IInlineSyntaxRule } from '../customSyntax';
import type { CustomInlineToken, Token } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASS_NAMES } from '../../config';
import { Muya } from '../../muya';
import { renderToStaticHTML } from '../../state/renderToStaticHTML';
import { registerInlineSyntax } from '../customSyntax';
import { tokenizer } from '../lexer';

const wikilink: IInlineSyntaxRule = {
    name: 'wikilink',
    precedence: 'beforeEmphasis',
    noSpellcheck: true,
    match(src) {
        const m = /^\[\[([^[\]\n]+)\]\]/.exec(src);

        return m
            ? { length: m[0].length, contentStart: 2, contentEnd: m[0].length - 2, data: { target: m[1] } }
            : null;
    },
    exportHtml(_raw, data) {
        return `<a class="wiki" href="#${data.target.replace(/[^\w-]/g, '')}">W</a>`;
    },
};

// Deliberately ignores `prevChar`, so only engine precedence keeps it out of
// code, link destinations and autolinks.
const hashtag: IInlineSyntaxRule = {
    name: 'hashtag',
    precedence: 'afterHtml',
    match(src) {
        const m = /^#[a-z]+/.exec(src);

        return m ? { length: m[0].length, contentStart: 0, contentEnd: m[0].length, data: { tag: m[0].slice(1) } } : null;
    },
};

const icon: IInlineSyntaxRule = {
    name: 'icon',
    precedence: 'beforeEmoji',
    match(src) {
        const m = /^:lucide-([a-z-]+):/.exec(src);

        return m ? { length: m[0].length, contentStart: 1, contentEnd: m[0].length - 1, data: { icon: m[1] } } : null;
    },
};

let disposers: (() => void)[] = [];
const bootedHosts: HTMLElement[] = [];

function use(...rules: IInlineSyntaxRule[]) {
    for (const rule of rules)
        disposers.push(registerInlineSyntax(rule));
}

function flatten(tokens: Token[]): Token[] {
    return tokens.flatMap(t => ['children' in t && Array.isArray(t.children) ? [t, ...flatten(t.children)] : [t]].flat());
}

function custom(src: string) {
    return flatten(tokenizer(src)).filter((t): t is CustomInlineToken => t.type === 'custom_inline');
}

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);

    return muya;
}

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    disposers.forEach(dispose => dispose());
    disposers = [];
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
});

describe('registerInlineSyntax: validation', () => {
    it('rejects invalid names, unknown precedence and duplicates', () => {
        expect(() => registerInlineSyntax({ ...wikilink, name: 'Wiki' })).toThrow();
        expect(() => registerInlineSyntax({ ...wikilink, precedence: 'first' as never })).toThrow();
        use(wikilink);
        expect(() => registerInlineSyntax({ ...wikilink })).toThrow(/already registered/);
    });

    it('ignores matches that break the contract instead of corrupting the text', () => {
        use({ ...hashtag, match: () => ({ length: 99, contentStart: 0, contentEnd: 1, data: {} }) });
        expect(custom('#a')).toEqual([]);
    });
});

describe('lexer precedence', () => {
    it('beforeEmphasis: underscores inside the token are never emphasis', () => {
        use(wikilink);
        const tokens = flatten(tokenizer('x [[a_b_c]] _y_'));
        const wiki = tokens.find(t => t.type === 'custom_inline') as CustomInlineToken;
        expect(wiki.raw).toBe('[[a_b_c]]');
        expect(wiki.range).toEqual({ start: 2, end: 11 });
        expect([wiki.contentStart, wiki.contentEnd]).toEqual([4, 9]);
        expect(wiki.data).toEqual({ target: 'a_b_c' });
        // Only the real `_y_` outside the token is emphasis.
        const ems = tokens.filter(t => t.type === 'em');
        expect(ems.map(t => t.raw)).toEqual(['_y_']);
    });

    it('beforeEmphasis: a delimiter opened before the token cannot close inside it', () => {
        use(wikilink);
        expect(flatten(tokenizer('_a [[b_ c]]')).some(t => t.type === 'em')).toBe(false);
    });

    it('beforeEmoji: an icon shortcode becomes the custom token, not an emoji', () => {
        use(icon);
        const tokens = flatten(tokenizer('go :lucide-house: :smile:'));
        expect(custom('go :lucide-house: :smile:').map(t => t.data.icon)).toEqual(['house']);
        expect(tokens.filter(t => t.type === 'emoji').map(t => t.raw)).toEqual([':smile:']);
    });

    it('afterHtml: never matches inside inline code, link destinations or autolinks', () => {
        use(hashtag);
        expect(custom('`#code`')).toEqual([]);
        expect(custom('[a](http://x.org/#frag)')).toEqual([]);
        expect(custom('<http://x.org/#frag>')).toEqual([]);
        expect(custom('www.example.com/#frag')).toEqual([]);
        expect(custom('<span title="#attr">x</span>')).toEqual([]);
        expect(custom('#tag and [#inlink](u)').map(t => t.raw)).toEqual(['#tag', '#inlink']);
    });

    it('unregistering restores the default tokenization', () => {
        const dispose = registerInlineSyntax(wikilink);
        expect(custom('[[a_b_]]')).toHaveLength(1);
        dispose();
        expect(custom('[[a_b_]]')).toEqual([]);
    });
});

describe('rendering', () => {
    function paragraph(muya: Muya) {
        return muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
    }

    it('renders span.mu-inline-<name> whose textContent is the source, caret outside and inside', () => {
        use(wikilink);
        const source = 'see [[a_b_c]] now';
        const muya = bootMuya(source);
        const block = paragraph(muya);

        block.setCursor(0, 0, true);
        let token = block.domNode!.querySelector<HTMLElement>('span.mu-inline-wikilink')!;
        expect(block.domNode!.textContent).toBe(source);
        expect(token.textContent).toBe('[[a_b_c]]');
        expect(token.dataset.target).toBe('a_b_c');
        expect(token.getAttribute('spellcheck')).toBe('false');
        expect(token.querySelector('em')).toBeNull();
        expect(token.querySelectorAll(`.${CLASS_NAMES.MU_HIDE}`)).toHaveLength(2);

        block.setCursor(6, 6, true);
        token = block.domNode!.querySelector<HTMLElement>('span.mu-inline-wikilink')!;
        expect(block.domNode!.textContent).toBe(source);
        expect(token.querySelectorAll(`.${CLASS_NAMES.MU_HIDE}`)).toHaveLength(0);
        expect(token.querySelectorAll(`.${CLASS_NAMES.MU_GRAY}`)).toHaveLength(2);
    });

    it('paints search highlights inside the token content', () => {
        use(wikilink);
        const muya = bootMuya('x [[abc]]');
        muya.search('b');
        const token = paragraph(muya).domNode!.querySelector('span.mu-inline-wikilink')!;
        expect(token.querySelector(`.${CLASS_NAMES.MU_HIGHLIGHT}`)?.textContent).toBe('b');
    });

    it('refreshInlineRendering applies late rules without touching state or history', () => {
        const muya = bootMuya('see [[a_b]]');
        const before = muya.getMarkdown();
        expect(muya.domNode.querySelector('span.mu-inline-wikilink')).toBeNull();

        use(wikilink);
        muya.refreshInlineRendering();

        expect(muya.domNode.querySelector('span.mu-inline-wikilink')?.textContent).toBe('[[a_b]]');
        muya.flush();
        expect(muya.getMarkdown()).toBe(before);
        expect(muya.editor.history.canUndo()).toBe(false);
    });

    it('ctrl/cmd-click emits format-click with the rule name and match data', () => {
        use(wikilink);
        const muya = bootMuya('[[Note A]]');
        const handler = vi.fn();
        muya.on('format-click', handler);
        const content = muya.domNode.querySelector('span.mu-inline-wikilink .mu-inline-rule')!;

        content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(handler).not.toHaveBeenCalled();

        content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
        expect(handler).toHaveBeenCalledTimes(1);
        const payload = handler.mock.calls[0][0];
        expect(payload.event).toBeInstanceOf(MouseEvent);
        expect(payload.formatType).toBe('wikilink');
        expect(payload.data).toEqual({ target: 'Note A' });
    });
});

describe('export', () => {
    const md = 'a [[x_y]] `[[code]]` #tag & <b>[[z]]</b>\n\n```js\n[[nope]]\n```\n';

    it('is byte-identical once every rule is unregistered', () => {
        const baseline = renderToStaticHTML(md, { sanitize: false });
        const dispose = registerInlineSyntax(wikilink);
        expect(renderToStaticHTML(md, { sanitize: false })).not.toBe(baseline);
        dispose();
        expect(renderToStaticHTML(md, { sanitize: false })).toBe(baseline);
    });

    it('renders tokens through exportHtml, or as escaped source without it', () => {
        use(wikilink, { ...hashtag, match: src => (src.startsWith('#tag') ? { length: 4, contentStart: 1, contentEnd: 4, data: {} } : null) });
        const html = renderToStaticHTML(md, { sanitize: false });
        expect(html).toContain('<a class="wiki" href="#x_y">W</a>');
        expect(html).toContain('<a class="wiki" href="#z">W</a>');
        expect(html).toContain('<code>[[code]]</code>');
        expect(html).not.toContain('href="#nope"');
        expect(html).toContain('#tag &amp;');
    });
});
