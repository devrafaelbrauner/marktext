import type { IDiagramState } from '../types';
import { describe, expect, it } from 'vitest';
import { createDiagramState } from '../../utils/diagram/fence';
import { MarkdownToState } from '../markdownToState';
import ExportMarkdown from '../stateToMarkdown';

// Diagram blocks keep their fence character, fence length and full info
// string through markdown → state → markdown.

function gen(markdown: string): Parameters<ExportMarkdown['generate']>[0] {
    return new MarkdownToState({
        footnote: false,
        texMathDollars: false,
        texMathGfm: false,
        texMathSingleBackslash: false,
        texMathDoubleBackslash: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: false,
    }).generate(markdown) as unknown as Parameters<ExportMarkdown['generate']>[0];
}

function roundTrip(markdown: string): string {
    return new ExportMarkdown().generate(gen(markdown));
}

describe('diagram fence fidelity', () => {
    it.each([
        ['tilde fence', '~~~mermaid\ngraph TD\n  A --> B\n~~~\n'],
        ['4-backtick fence', '````mermaid\ngraph TD\n  A --> B\n````\n'],
        ['long tilde fence', '~~~~~plantuml\n@startuml\nA -> B\n@enduml\n~~~~~\n'],
        ['info string extras', '```mermaid title="Flow" {.wide}\ngraph LR\n  A --> B\n```\n'],
        ['plain fence', '```vega-lite\n{}\n```\n'],
    ])('round-trips a %s byte-identically', (_name, markdown) => {
        const states = gen(markdown) as unknown as IDiagramState[];
        expect(states[0].name).toBe('diagram');
        expect(roundTrip(markdown)).toBe(markdown);
    });

    it('stores the fence in the diagram meta', () => {
        const [state] = gen('~~~~mermaid  theme dark\nA\n~~~~\n') as unknown as IDiagramState[];
        expect(state.meta).toEqual({
            type: 'mermaid',
            lang: 'yaml',
            fenceChar: '~',
            fenceLength: 4,
            info: 'mermaid  theme dark',
        });
    });

    it('lengthens the fence when the content contains a backtick fence', () => {
        const state = createDiagramState('mermaid', 'graph TD\n```\nA --> B');
        const md = new ExportMarkdown().generate([state]);
        expect(md).toBe('````mermaid\ngraph TD\n```\nA --> B\n````\n');
        const [reparsed] = gen(md) as unknown as IDiagramState[];
        expect(reparsed.name).toBe('diagram');
        expect(reparsed.text).toBe('graph TD\n```\nA --> B');
    });

    it('lengthens a tilde fence past a tilde run in the content', () => {
        const state = createDiagramState('mermaid', 'A\n~~~~\nB', { fenceChar: '~' });
        expect(new ExportMarkdown().generate([state])).toBe('~~~~~mermaid\nA\n~~~~\nB\n~~~~~\n');
    });

    it('serializes an editor-created diagram with a plain backtick fence', () => {
        expect(new ExportMarkdown().generate([createDiagramState('mermaid', 'A')])).toBe('```mermaid\nA\n```\n');
    });

    it('keeps the fence inside a list item', () => {
        const markdown = '- item\n\n  ~~~mermaid\n  A\n  ~~~\n';
        expect(roundTrip(markdown)).toBe(markdown);
    });
});
