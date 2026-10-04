import type { MarkedExtension, Token, Tokens } from 'marked';
import { Marked } from 'marked';
import { firstWordOfInfo } from '../utils';
import logger from '../utils/logger';
import { getCodeBlockRenderer, hasCodeBlockRenderers } from './registry';

const debug = logger('codeBlockPreview:');

// `exportHtml` results already awaited, keyed by `exportKey`.
export type TCodeBlockExports = Map<string, string>;

type TSourceCodeToken = Tokens.Code & { muSource?: string };

function exportKey(lang: string, source: string) {
    return `${lang}\n${source}`;
}

function exporterFor(info: string | undefined) {
    const lang = firstWordOfInfo(info ?? '').toLowerCase();
    const exportHtml = lang ? getCodeBlockRenderer(lang)?.exportHtml : undefined;

    return exportHtml ? { lang, exportHtml } : null;
}

/**
 * Awaits `exportHtml` of every fenced block claimed by a registered renderer,
 * so the synchronous HTML pass can use asynchronous exporters too. Failed
 * exports are left out and fall back to code.
 */
export async function resolveCodeBlockExports(markdown: string): Promise<TCodeBlockExports> {
    const resolved: TCodeBlockExports = new Map();
    if (!hasCodeBlockRenderers())
        return resolved;
    const pending: Promise<void>[] = [];
    const marked = new Marked();

    marked.walkTokens(marked.lexer(markdown), (token: Token) => {
        if (token.type !== 'code')
            return;
        const exporter = exporterFor(token.lang);
        if (!exporter)
            return;
        const key = exportKey(exporter.lang, token.text);
        pending.push(
            Promise.resolve()
                .then(() => exporter.exportHtml(token.text, exporter.lang))
                .then((html) => {
                    resolved.set(key, html);
                }, (error) => {
                    debug.warn(String(error));
                }),
        );
    });
    await Promise.all(pending);

    return resolved;
}

/**
 * marked extension exporting claimed fenced blocks as
 * `div.mu-code-block-export` around `exportHtml`. Without a pre-resolved
 * result only a synchronous `exportHtml` can be used; otherwise the block
 * keeps the normal code export.
 */
export function codeBlockExportExtension(resolved?: TCodeBlockExports): MarkedExtension {
    return {
        // Runs before marked-highlight replaces `text` with highlighted markup.
        walkTokens(token) {
            if (token.type === 'code')
                (token as TSourceCodeToken).muSource = token.text;
        },
        renderer: {
            code(token) {
                const exporter = exporterFor(token.lang);
                if (!exporter)
                    return false;
                const source = (token as TSourceCodeToken).muSource ?? token.text;
                let html = resolved?.get(exportKey(exporter.lang, source));
                if (html == null) {
                    try {
                        const result = exporter.exportHtml(source, exporter.lang);
                        if (typeof result === 'string')
                            html = result;
                        else
                            result.catch(error => debug.warn(String(error)));
                    }
                    catch (error) {
                        debug.warn(String(error));
                    }
                }
                if (html == null)
                    return false;

                return `<div class="mu-code-block-export" data-lang="${exporter.lang.replace(/"/g, '&quot;')}">${html}</div>\n`;
            },
        },
    };
}
