// @vitest-environment happy-dom

import type Format from '../format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

const muyas: Muya[] = [];

function boot(options: Partial<ConstructorParameters<typeof Muya>[1]> = {}): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown: 'x', ...options } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    muyas.push(muya);

    return muya;
}

function type(muya: Muya, raw: string) {
    const block = muya.editor.scrollPage!.firstContentInDescendant() as unknown as Format;
    block.domNode!.textContent = raw;
    block.setCursor(raw.length, raw.length);
    block.inputHandler(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: raw[raw.length - 1] }));

    return muya.editor.scrollPage!.children.head!.blockName;
}

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (muyas.length)
        muyas.pop()!.destroy();
    document.getSelection()?.removeAllRanges();
});

describe('atxHeadingRequiresSpace', () => {
    it('off (default): a lone `#` promotes the paragraph', () => {
        expect(type(boot(), '#')).toBe('atx-heading');
    });

    it('on: `#` and `#tag` stay paragraphs, `# ` still becomes a heading', () => {
        const muya = boot({ atxHeadingRequiresSpace: true });
        expect(type(muya, '#')).toBe('paragraph');
        expect(type(muya, '#tag')).toBe('paragraph');
        expect(type(muya, '##tag')).toBe('paragraph');
        expect(type(muya, '# ')).toBe('atx-heading');
    });

    it('toggles through setOptions without re-rendering the document', () => {
        const muya = boot();
        const paragraphNode = muya.editor.scrollPage!.children.head!.domNode;

        muya.setOptions({ atxHeadingRequiresSpace: true });
        expect(muya.editor.scrollPage!.children.head!.domNode).toBe(paragraphNode);
        expect(type(muya, '#tag')).toBe('paragraph');

        muya.setOptions({ atxHeadingRequiresSpace: false });
        expect(type(muya, '#tag')).toBe('paragraph');
        expect(type(muya, '#')).toBe('atx-heading');
    });
});
