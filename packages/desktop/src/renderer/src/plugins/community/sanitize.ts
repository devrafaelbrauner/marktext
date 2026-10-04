/**
 * Community code-block previews are HTML strings, not Vue components. The
 * host inserts them only after this pass, so a plugin cannot ship a script
 * or an event handler into the editor document.
 */

import { sanitize } from '@/util/dompurify'

export const sanitizeCommunityHtml = (html: string): string =>
  sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'style', 'base'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false
  })
