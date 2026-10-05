// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isMouseEvent, isPointerEvent, isTouchPointerEvent } from '../index';

describe('pointer event guards', () => {
    it('accepts every mouse-family event as a mouse event', () => {
        expect(isMouseEvent(new MouseEvent('click'))).toBe(true);
        expect(isMouseEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))).toBe(true);
        expect(isMouseEvent(new PointerEvent('pointermove', { pointerType: 'mouse' }))).toBe(true);
    });

    it('rejects keyboard, input and plain events', () => {
        expect(isMouseEvent(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
        expect(isMouseEvent(new InputEvent('input'))).toBe(false);
        expect(isMouseEvent(new Event('selectionchange'))).toBe(false);
    });

    it('tells pointer events from plain mouse events', () => {
        expect(isPointerEvent(new PointerEvent('pointerup', { pointerType: 'pen' }))).toBe(true);
        expect(isPointerEvent(new MouseEvent('mouseup'))).toBe(false);
    });

    it('flags only a finger as a touch pointer', () => {
        expect(isTouchPointerEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }))).toBe(true);
        expect(isTouchPointerEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }))).toBe(false);
        expect(isTouchPointerEvent(new PointerEvent('pointerdown', { pointerType: 'pen' }))).toBe(false);
        expect(isTouchPointerEvent(new MouseEvent('click'))).toBe(false);
    });
});
