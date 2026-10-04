import type { Muya } from '../muya';

export interface ICompletionItem {
    label: string;
    detail?: string;
    /** Replaces the text matched by the trigger (and `consumeAfter`). */
    insertText: string;
    /** Caret position inside `insertText` after insertion. Default: its end. */
    caretOffset?: number;
}

/**
 * Autocomplete source shown while the text before the caret matches
 * `trigger`. While its list is open the emoji picker stays closed.
 */
export interface ICompletionProvider {
    id: string;
    /** Tested against the block text before the caret; ends with `$`. Group 1 is the query. */
    trigger: RegExp;
    /** Text right after the caret the insertion also replaces; starts with `^`. */
    consumeAfter?: RegExp;
    getItems: (query: string) => ICompletionItem[] | Promise<ICompletionItem[]>;
}

export interface ICompletionTrigger {
    provider: ICompletionProvider;
    /** Offset in the block text where the trigger match starts. */
    start: number;
    query: string;
}

const providers: ICompletionProvider[] = [];

/** Registers `provider` for every editor; returns the unregister function. */
export function registerCompletionProvider(provider: ICompletionProvider): () => void {
    if (!provider.id)
        throw new Error('A completion provider needs an id.');
    if (providers.some(p => p.id === provider.id))
        throw new Error(`Completion provider "${provider.id}" is already registered.`);
    if (provider.trigger.global || provider.trigger.sticky)
        throw new Error(`Completion provider "${provider.id}": trigger must not be global or sticky.`);

    providers.push(provider);

    return () => {
        const index = providers.indexOf(provider);
        if (index !== -1)
            providers.splice(index, 1);
    };
}

/**
 * First provider (registration order) whose trigger matches the end of
 * `textBeforeCaret`.
 */
export function findCompletionTrigger(textBeforeCaret: string): ICompletionTrigger | null {
    for (const provider of providers) {
        const match = provider.trigger.exec(textBeforeCaret);
        if (match && match.index + match[0].length === textBeforeCaret.length) {
            return {
                provider,
                start: match.index,
                query: match[1] ?? '',
            };
        }
    }

    return null;
}

/** Length of the `consumeAfter` match at the start of `textAfterCaret`. */
export function consumedAfterLength(provider: ICompletionProvider, textAfterCaret: string): number {
    if (!provider.consumeAfter)
        return 0;
    const match = provider.consumeAfter.exec(textAfterCaret);

    return match && match.index === 0 ? match[0].length : 0;
}

// Editors whose completion list currently owns the caret context.
const activeSessions = new WeakSet<Muya>();

export function setCompletionActive(muya: Muya, active: boolean) {
    if (active)
        activeSessions.add(muya);
    else
        activeSessions.delete(muya);
}

/** True while a provider claims the caret context of `muya` (emoji picker stays closed). */
export function isCompletionActive(muya: Muya): boolean {
    return activeSessions.has(muya);
}
