import type { CustomInlineToken, Token } from './types';
import { escapeHTML } from '../utils';

export interface IInlineSyntaxMatch {
    /** Number of source characters the token consumes; > 0. */
    length: number;
    /**
     * `[contentStart, contentEnd)`, relative to the match start, is the token
     * text; the characters outside it are markers, hidden unless the caret is
     * inside the token.
     */
    contentStart: number;
    contentEnd: number;
    /** Rendered as `data-*` attributes and passed to `format-click`. */
    data: Record<string, string>;
}

export type TInlineSyntaxPrecedence = 'beforeEmphasis' | 'beforeEmoji' | 'afterHtml';

/**
 * Extra inline syntax, registered globally for every editor. The token
 * renders as `span.mu-inline-<name>` whose text content is exactly the
 * matched source.
 */
export interface IInlineSyntaxRule {
    /** Token name, /^[a-z][a-z0-9-]*$/, unique. */
    name: string;
    precedence: TInlineSyntaxPrecedence;
    /**
     * `src` runs from the lexer position to the end of the text; `prevChar` is
     * the character before it ('' at the start). Called very often: keep it
     * cheap and ReDoS-safe.
     */
    match: (src: string, prevChar: string) => IInlineSyntaxMatch | null;
    noSpellcheck?: boolean;
    /** Export HTML; must escape user text. Default: the escaped source. */
    exportHtml?: (raw: string, data: Record<string, string>) => string;
}

const NAME_REG = /^[a-z][a-z0-9-]*$/;
const PRECEDENCES: Record<TInlineSyntaxPrecedence, true> = { beforeEmphasis: true, beforeEmoji: true, afterHtml: true };

const rules: IInlineSyntaxRule[] = [];

/**
 * Registers `rule` for every editor; returns the unregister function. Call
 * `muya.refreshInlineRendering()` afterwards for already rendered documents.
 */
export function registerInlineSyntax(rule: IInlineSyntaxRule): () => void {
    if (!NAME_REG.test(rule.name))
        throw new Error(`Invalid inline syntax name "${rule.name}".`);
    if (PRECEDENCES[rule.precedence] !== true)
        throw new Error(`Invalid inline syntax precedence "${rule.precedence}".`);
    if (rules.some(r => r.name === rule.name))
        throw new Error(`Inline syntax "${rule.name}" is already registered.`);

    rules.push(rule);

    return () => {
        const index = rules.indexOf(rule);
        if (index !== -1)
            rules.splice(index, 1);
    };
}

export function hasInlineSyntaxRules() {
    return rules.length > 0;
}

export function getInlineSyntaxRules(): readonly IInlineSyntaxRule[] {
    return rules;
}

export function getInlineSyntaxRule(name: string): IInlineSyntaxRule | undefined {
    return rules.find(r => r.name === name);
}

export function isCustomInlineToken(token: Token): token is CustomInlineToken {
    return token.type === 'custom_inline';
}

export interface ICustomSyntaxHit {
    rule: IInlineSyntaxRule;
    match: IInlineSyntaxMatch;
}

/**
 * First rule of `precedence` (registration order) that matches `src`. A
 * match that violates its own contract (empty, past the source, inverted
 * content range) is ignored so a buggy rule can never corrupt the text.
 */
export function matchInlineSyntax(
    precedence: TInlineSyntaxPrecedence,
    src: string,
    prevChar: string,
): ICustomSyntaxHit | null {
    for (const rule of rules) {
        if (rule.precedence !== precedence)
            continue;

        const match = rule.match(src, prevChar);
        if (
            match
            && Number.isInteger(match.length)
            && match.length > 0
            && match.length <= src.length
            && match.contentStart >= 0
            && match.contentStart <= match.contentEnd
            && match.contentEnd <= match.length
        ) {
            return { rule, match };
        }
    }

    return null;
}

interface ICustomInlineMarkedToken {
    type: 'muCustomInline';
    raw: string;
    name: string;
    data: Record<string, string>;
}

const PRECEDENCE_ORDER: readonly TInlineSyntaxPrecedence[] = ['beforeEmphasis', 'beforeEmoji', 'afterHtml'];

function matchAny(src: string, prevChar: string): ICustomSyntaxHit | null {
    for (const precedence of PRECEDENCE_ORDER) {
        const hit = matchInlineSyntax(precedence, src, prevChar);
        if (hit)
            return hit;
    }

    return null;
}

/**
 * marked extension rendering registered rules in HTML export through
 * `exportHtml` (default: the escaped source). Registered last, it runs before
 * marked's own inline tokenizers at each position, but code spans, links,
 * autolinks and raw HTML are consumed whole, so their insides never match.
 */
export function customInlineMarkedExtension() {
    return {
        extensions: [{
            name: 'muCustomInline',
            level: 'inline' as const,
            start(src: string) {
                for (let i = 0; i < src.length; i++) {
                    if (matchAny(src.substring(i), src[i - 1] ?? ''))
                        return i;
                }

                return undefined;
            },
            tokenizer(src: string, tokens: { raw: string }[]): ICustomInlineMarkedToken | undefined {
                const prevChar = tokens[tokens.length - 1]?.raw.slice(-1) ?? '';
                const hit = matchAny(src, prevChar);
                if (!hit)
                    return undefined;

                return {
                    type: 'muCustomInline',
                    raw: src.substring(0, hit.match.length),
                    name: hit.rule.name,
                    data: { ...hit.match.data },
                };
            },
            renderer(token: ICustomInlineMarkedToken) {
                const rule = getInlineSyntaxRule(token.name);

                return rule?.exportHtml
                    ? rule.exportHtml(token.raw, token.data)
                    : escapeHTML(token.raw);
            },
        }],
    };
}
