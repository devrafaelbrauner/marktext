// @vitest-environment happy-dom

import type { Muya } from '../../../index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import EventCenter from '../../../event';
import BaseFloat from '../index';

// A float hides once the editor scrolls 50px past where it was opened. The
// soft keyboard opening or closing resizes the viewport and scrolls the editor
// to keep the caret visible; that scroll must not count as the user leaving.

class TestFloat extends BaseFloat {}

const reference = {
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
};

let domNode: HTMLElement;
let viewport: { height: number };

function makeFloat(): TestFloat {
    const muya = { eventCenter: new EventCenter(), domNode } as unknown as Muya;
    const float = new TestFloat(muya, 'mu-test-float');
    float.listen();
    float.show(reference);
    return float;
}

function scrollTo(top: number): void {
    domNode.scrollTop = top;
    domNode.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
    domNode = document.createElement('div');
    domNode.style.overflowY = 'auto';
    document.body.appendChild(domNode);
    let scrollTop = 0;
    Object.defineProperty(domNode, 'scrollTop', {
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = value;
        },
        configurable: true,
    });
    // floating-ui's autoUpdate listens on the visual viewport too.
    viewport = Object.assign(new EventTarget(), { height: 800 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
});

afterEach(() => {
    domNode.remove();
    Reflect.deleteProperty(window, 'visualViewport');
});

describe('baseFloat scroll-away hiding', () => {
    it('hides after the user scrolls more than 50px', () => {
        const float = makeFloat();
        scrollTo(0);
        scrollTo(80);

        expect(float.status).toBe(false);
    });

    it('stays open through a scroll caused by the keyboard resizing the viewport', () => {
        const float = makeFloat();
        scrollTo(0);

        viewport.height = 450;
        scrollTo(300);
        expect(float.status).toBe(true);

        // Measured from the post-keyboard baseline from here on.
        scrollTo(330);
        expect(float.status).toBe(true);
        scrollTo(400);
        expect(float.status).toBe(false);
    });
});
