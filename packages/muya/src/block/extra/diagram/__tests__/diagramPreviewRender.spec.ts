// @vitest-environment happy-dom
import type { Muya } from '../../../../muya';
import type { IDiagramState } from '../../../../state/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventCenter from '../../../../event';
import I18n from '../../../../i18n';
import { en } from '../../../../locales/en';
import DiagramPreview, { DIAGRAM_RENDER_DEBOUNCE } from '../diagramPreview';

// Mermaid itself does not load under happy-dom; the mock returns an svg built
// from the code so each render's output is identifiable.
const loadRendererMock = vi.fn();
vi.mock('../../../../utils/diagram', () => ({
    default: (...args: unknown[]) => loadRendererMock(...args),
}));

interface IDeferred { resolve: () => void }

let pending: Map<string, IDeferred>;
let initializeCalls: Record<string, unknown>[];
let holdRenders: boolean;

function mermaidMock() {
    return {
        initialize: (config: Record<string, unknown>) => initializeCalls.push(config),
        parse: async () => true,
        render: async (_id: string, code: string) => {
            if (holdRenders)
                await new Promise<void>(resolve => pending.set(code, { resolve }));
            return { svg: `<svg data-code="${code.split('\n')[0]}" viewBox="0 0 1 1">${code.includes('internal') ? '<g class="node internal-link" id="n1"><text>My  Note</text></g>' : ''}</svg>` };
        },
    };
}

const hosts: HTMLElement[] = [];

function makePreview(text: string, options: Record<string, unknown> = {}) {
    const muya = {
        options: { mermaidTheme: 'default', vegaTheme: 'default', sequenceTheme: 'hand', ...options },
        eventCenter: new EventCenter(),
    } as unknown as Muya;
    (muya as unknown as { i18n: I18n }).i18n = new I18n(muya, en);
    const state: IDiagramState = { name: 'diagram', text, meta: { lang: 'yaml', type: 'mermaid' } };
    const preview = new DiagramPreview(muya, state);
    document.body.appendChild(preview.domNode!);
    hosts.push(preview.domNode!);
    return { preview, muya };
}

const renderedCode = (preview: DiagramPreview) => preview.domNode!.querySelector('svg')?.getAttribute('data-code');

beforeEach(() => {
    pending = new Map();
    initializeCalls = [];
    holdRenders = false;
    loadRendererMock.mockImplementation(async () => mermaidMock());
});

afterEach(() => {
    vi.useRealTimers();
    while (hosts.length) hosts.pop()!.remove();
    loadRendererMock.mockReset();
});

describe('diagramPreview — debounce', () => {
    it('renders once, after typing pauses', async () => {
        const { preview } = makePreview('graph A');
        await preview.update();
        vi.useFakeTimers();
        loadRendererMock.mockClear();

        preview.scheduleUpdate('graph B');
        await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_DEBOUNCE - 50);
        preview.scheduleUpdate('graph C');
        await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_DEBOUNCE - 50);
        expect(loadRendererMock).not.toHaveBeenCalled();
        expect(renderedCode(preview)).toBe('graph A');

        await vi.advanceTimersByTimeAsync(60);
        expect(loadRendererMock).toHaveBeenCalledTimes(1);
        expect(renderedCode(preview)).toBe('graph C');
    });

    it('skips a scheduled render once the block left the document', async () => {
        const { preview } = makePreview('graph A');
        await preview.update();
        vi.useFakeTimers();
        loadRendererMock.mockClear();
        preview.scheduleUpdate('graph B');
        preview.domNode!.remove();
        await vi.advanceTimersByTimeAsync(DIAGRAM_RENDER_DEBOUNCE + 10);
        expect(loadRendererMock).not.toHaveBeenCalled();
    });
});

describe('diagramPreview — stale renders', () => {
    it('never lets a slow older render overwrite a newer one', async () => {
        const { preview } = makePreview('graph A');
        await preview.update();
        holdRenders = true;

        const slow = preview.update('graph slow');
        const fast = preview.update('graph fast');
        await vi.waitFor(() => expect(pending.size).toBe(2));
        pending.get('graph fast')!.resolve();
        await fast;
        expect(renderedCode(preview)).toBe('graph fast');

        pending.get('graph slow')!.resolve();
        await slow;
        expect(renderedCode(preview)).toBe('graph fast');
        // Staging elements never stay in the document.
        expect(document.body.querySelectorAll('[aria-hidden="true"].mu-diagram-preview')).toHaveLength(0);
    });

    it('keeps the previous diagram visible while a re-render is pending', async () => {
        const { preview } = makePreview('graph A');
        await preview.update();
        holdRenders = true;
        const next = preview.update('graph B');
        expect(renderedCode(preview)).toBe('graph A');
        await vi.waitFor(() => expect(pending.size).toBe(1));
        pending.get('graph B')!.resolve();
        await next;
        expect(renderedCode(preview)).toBe('graph B');
    });
});

describe('diagramPreview — internal links', () => {
    function click(target: Element, init: MouseEventInit) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        return event;
    }

    it('gives internal-link nodes a pointer cursor and emits their label on Cmd/Ctrl-click', async () => {
        const { preview, muya } = makePreview('graph internal');
        await preview.update();
        const node = preview.domNode!.querySelector<SVGElement>('.internal-link')!;
        expect(node.style.cursor).toBe('pointer');

        const listener = vi.fn();
        muya.eventCenter.on('format-click', listener);
        const text = node.querySelector('text')!;
        const event = click(text, { ctrlKey: true });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({
            event,
            formatType: 'mermaid-internal-link',
            data: { target: 'My Note' },
        });

        click(text, { metaKey: true });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('ignores plain clicks and clicks outside internal-link nodes', async () => {
        const { preview, muya } = makePreview('graph internal');
        await preview.update();
        const listener = vi.fn();
        muya.eventCenter.on('format-click', listener);
        click(preview.domNode!.querySelector('.internal-link text')!, {});
        click(preview.domNode!.querySelector('svg')!, { ctrlKey: true });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('diagramPreview — mermaid options', () => {
    it('uses the app theme and the classic look by default', async () => {
        const { preview } = makePreview('graph A', { mermaidTheme: 'dark' });
        await preview.update();
        expect(initializeCalls.at(-1)).toMatchObject({ theme: 'dark', look: 'classic', securityLevel: 'strict' });
    });

    it('lets an explicit theme override the app theme and applies the look', async () => {
        const { preview } = makePreview('graph A', { mermaidTheme: 'dark', mermaidThemeOverride: 'forest', mermaidLook: 'handDrawn' });
        await preview.update();
        expect(initializeCalls.at(-1)).toMatchObject({ theme: 'forest', look: 'handDrawn' });
    });
});

describe('muya.setOptions — mermaid options', () => {
    it('re-renders mermaid diagrams (only) when a mermaid option changes', async () => {
        window.MUYA_VERSION = 'test';
        const { Muya } = await import('../../../../muya');
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: '```mermaid\ngraph A\n```\n\n```plantuml\n@startuml\n@enduml\n```\n',
        } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);
        await vi.waitFor(() => expect(initializeCalls.length).toBeGreaterThan(0));
        loadRendererMock.mockClear();
        initializeCalls = [];

        muya.setOptions({ mermaidLook: 'handDrawn' });
        await vi.waitFor(() => expect(initializeCalls).toHaveLength(1));
        expect(initializeCalls[0]).toMatchObject({ look: 'handDrawn' });
        expect(loadRendererMock.mock.calls.map(call => call[0])).toEqual(['mermaid']);

        initializeCalls = [];
        muya.setOptions({ mermaidThemeOverride: 'neutral' });
        await vi.waitFor(() => expect(initializeCalls).toHaveLength(1));
        expect(initializeCalls[0]).toMatchObject({ theme: 'neutral', look: 'handDrawn' });

        initializeCalls = [];
        muya.setOptions({ vegaTheme: 'dark' });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(initializeCalls).toHaveLength(0);
    });
});
