import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures/muya';
import { getMarkdown } from '../helpers/api';
import { editor, floats } from '../helpers/selectors';

/**
 * Touch input on a phone-sized Chromium (device emulation: touch + mobile
 * viewport). What a finger produces differs from a mouse:
 *
 * - a tap fires pointer events, then compatibility mouse events and `click`;
 * - a finger drag scrolls (pointercancel), it never drag-selects;
 * - a long-press selects the word natively, and the system selection handles
 *   resize that range with nothing but `selectionchange` (no pointer events,
 *   no click).
 *
 * Chromium's emulation has no selection handles to drag, so a handle drag is
 * reproduced with `Selection.extend()` — which fires exactly what a handle
 * drag fires on Android: `selectionchange` alone.
 */

test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

interface IPoint { x: number; y: number }

// Centre of the `index`-th occurrence of `word` inside `root`, in CSS pixels.
async function wordCenter(page: Page, root: string, word: string): Promise<IPoint> {
    return page.evaluate(({ root, word }) => {
        const host = document.querySelector(root)!;
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = node.textContent!.indexOf(word);
            if (start === -1)
                continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + word.length);
            const rect = range.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
        throw new Error(`"${word}" not found in ${root}`);
    }, { root, word });
}

// A real long-press gesture: Chromium selects the word under it.
async function longPress(cdp: CDPSession, point: IPoint): Promise<void> {
    await cdp.send('Input.synthesizeTapGesture', {
        x: Math.round(point.x),
        y: Math.round(point.y),
        duration: 1000,
        tapCount: 1,
        gestureSourceType: 'touch',
    });
}

// Move the selection's focus to the end of `word` the way a handle drag does.
async function dragHandleTo(page: Page, root: string, word: string): Promise<void> {
    await page.evaluate(({ root, word }) => {
        const host = document.querySelector(root)!;
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = node.textContent!.indexOf(word);
            if (start !== -1) {
                document.getSelection()!.extend(node, start + word.length);
                return;
            }
        }
        throw new Error(`"${word}" not found in ${root}`);
    }, { root, word });
}

// Floats are parked at -9999px with opacity 0 when hidden, which Playwright
// still counts as "visible"; read the float wrapper's own state instead.
async function isFloatShown(page: Page, selector: string): Promise<boolean> {
    return page.evaluate((selector) => {
        const wrapper = document.querySelector(selector)?.closest<HTMLElement>('.mu-float-wrapper');
        return !!wrapper && wrapper.style.opacity === '1' && wrapper.style.left !== '-9999px';
    }, selector);
}

test.describe('touch input', () => {
    test('a tap places the caret where the finger lands', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha beta gamma'));
        const point = await wordCenter(page, editor.paragraph, 'beta');

        await page.touchscreen.tap(point.x, point.y);

        await expect.poll(() => page.evaluate(() => {
            const selection = window.muya!.editor.selection;
            return selection.anchor && selection.anchor.offset === selection.focus!.offset
                ? selection.anchor.offset
                : -1;
        })).toBeGreaterThanOrEqual(6);
        const offset = await page.evaluate(() => window.muya!.editor.selection.anchor!.offset);
        expect(offset).toBeLessThanOrEqual(10);
        expect(await page.evaluate(() => document.getSelection()!.isCollapsed)).toBe(true);
    });

    test('long-press then a handle drag selects words and opens the format toolbar', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha beta gamma delta'));
        const cdp = await page.context().newCDPSession(page);

        await longPress(cdp, await wordCenter(page, editor.paragraph, 'beta'));
        await expect.poll(() => page.evaluate(() => document.getSelection()!.toString())).toBe('beta');
        await expect.poll(() => isFloatShown(page, floats.inlineFormatToolbar)).toBe(true);

        await dragHandleTo(page, editor.paragraph, 'gamma');
        await expect.poll(() => page.evaluate(() => document.getSelection()!.toString())).toBe('beta gamma');
        await expect.poll(() => page.evaluate(() => {
            const { anchor, focus } = window.muya!.editor.selection;
            return [anchor?.offset, focus?.offset];
        })).toEqual([6, 16]);
        expect(await isFloatShown(page, floats.inlineFormatToolbar)).toBe(true);

        // The toolbar acts on the touch selection.
        await page.locator(`${floats.inlineFormatToolbar} li.item.strong`).tap();
        await expect.poll(() => getMarkdown(page)).toContain('alpha **beta gamma** delta');
    });

    test('a finger drag across words scrolls instead of selecting', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('alpha beta gamma delta'));
        const from = await wordCenter(page, editor.paragraph, 'alpha');
        const to = await wordCenter(page, editor.paragraph, 'delta');
        const cdp = await page.context().newCDPSession(page);

        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: (from.x + to.x) / 2, y: from.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

        expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('');
        expect(await isFloatShown(page, floats.inlineFormatToolbar)).toBe(false);
    });

    test('a tap on a link opens the link popover', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('Visit [Example](https://example.com) today.'));
        const point = await wordCenter(page, 'span.mu-link', 'Example');

        await page.touchscreen.tap(point.x, point.y);

        await expect.poll(() => isFloatShown(page, floats.linkTools)).toBe(true);
        await expect(page.locator(`${floats.linkTools} li.item.jump`)).toBeVisible();
        // The tap still edits: the caret is inside the link source, which the
        // tap re-rendered; the popover must sit on that live link.
        expect(await page.evaluate(() => document.getSelection()!.isCollapsed)).toBe(true);
        await expect.poll(() => page.evaluate((selector) => {
            const link = document.querySelector('span.mu-link')!.getBoundingClientRect();
            const popover = document.querySelector(selector)!.closest('.mu-float-wrapper')!.getBoundingClientRect();
            return Math.abs(popover.top - link.bottom) < 40 || Math.abs(popover.bottom - link.top) < 40;
        }, floats.linkTools)).toBe(true);
    });

    test('the image resize handle follows a finger', async ({ page }) => {
        // 120×60 SVG: wide enough that the right handle sits clear of the
        // paragraph front button the tap also reveals at the line start.
        const dataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxMjAnIGhlaWdodD0nNjAnPjxyZWN0IHdpZHRoPScxMjAnIGhlaWdodD0nNjAnIGZpbGw9J3RlYWwnLz48L3N2Zz4=';
        await page.evaluate(uri => window.muya!.setContent(`![alt](${uri})`), dataUri);
        const image = page.locator(editor.image).first();
        await expect.poll(() => image.evaluate(el => el.classList.contains('mu-image-success'))).toBe(true);
        const img = image.locator('img').first();

        await img.tap();
        const handle = page.locator(`${floats.imageTransformer} .bar.right`);
        await expect(handle).toBeVisible();
        const startWidth = Math.round((await img.boundingBox())!.width);
        const box = (await handle.boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const cdp = await page.context().newCDPSession(page);

        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        for (const dx of [20, 40, 60, 80])
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + dx, y: start.y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

        await expect.poll(() => getMarkdown(page)).toMatch(/<img [^>]*width="\d+"/);
        const width = Number((await getMarkdown(page)).match(/width="(\d+)"/)![1]);
        expect(width).toBe(startWidth + 80);
    });

    test('a long-press selection dragged across table cells selects the cell rectangle', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('| a1 | b1 | c1 |\n| --- | --- | --- |\n| a2 | b2 | c2 |\n| a3 | b3 | c3 |\n'));
        await expect(page.locator(editor.table).first()).toBeVisible();
        const cdp = await page.context().newCDPSession(page);

        await longPress(cdp, await wordCenter(page, editor.table, 'a1'));
        await expect.poll(() => page.evaluate(() => document.getSelection()!.toString())).toBe('a1');

        await dragHandleTo(page, editor.table, 'b2');
        await expect.poll(() => page.locator('.mu-table-cell-selected').count()).toBe(4);
        expect(await page.evaluate(() => window.muya!.editor.selection.table.followsNativeRange)).toBe(true);
        // The native range stays, so the handles keep resizing the rectangle.
        await dragHandleTo(page, editor.table, 'c3');
        await expect.poll(() => page.locator('.mu-table-cell-selected').count()).toBe(9);

        // A tap elsewhere drops it.
        const outside = await wordCenter(page, editor.table, 'a3');
        await page.touchscreen.tap(outside.x, outside.y);
        await expect.poll(() => page.locator('.mu-table-cell-selected').count()).toBe(0);
    });
});
