// Notes the browser dev build seeds its in-memory backend with, so the UI
// flows (sidebar tree, links, tags, tables, code, images) can be exercised in
// desktop Chromium without a device.

export const DEMO_VAULT_PATH = '/vault/demo/Demo'

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80">
  <rect width="160" height="80" rx="12" fill="#2f6fde"/>
  <text x="80" y="50" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">MarkText</text>
</svg>
`

export const DEMO_VAULT_FILES: Record<string, string> = {
  [`${DEMO_VAULT_PATH}/Welcome.md`]: `# Welcome

This demo vault lives in memory: edits are saved until the page reloads.

See [[Ideas]] and the plan in [[Projects/Plan]]. #demo #android

| Feature | Status |
| ------- | ------ |
| Editing | ✅ |
| Saving  | ✅ |

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`
\`\`\`

![logo](assets/logo.svg)
`,
  [`${DEMO_VAULT_PATH}/Ideas.md`]: `# Ideas

- Write on the phone, finish on the desktop. #demo
- Back to [[Welcome]].
`,
  [`${DEMO_VAULT_PATH}/Projects/Plan.md`]: `# Plan

1. Open a folder.
2. Edit a note.
3. Save it. #todo
`,
  [`${DEMO_VAULT_PATH}/assets/logo.svg`]: LOGO_SVG
}
