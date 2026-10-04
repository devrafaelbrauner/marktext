/** Diagram kinds offered by the "Insert diagram" commands, in menu order. */
export const DIAGRAM_KINDS = [
  'flowchart',
  'sequence',
  'class',
  'state',
  'er',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'quadrant'
] as const

export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

/** Translates a key relative to `templates.<kind>.`. */
type Label = (key: string) => string

// Labels are inserted unescaped: the translations must avoid `"`, `;`, `:`,
// `#`, brackets and parentheses so every language yields valid mermaid.
const TEMPLATES: Record<DiagramKind, (l: Label) => string[]> = {
  flowchart: (l) => [
    'flowchart TD',
    `  A["${l('start')}"] --> B{"${l('question')}"}`,
    `  B -->|"${l('yes')}"| C["${l('action')}"]`,
    `  B -->|"${l('no')}"| D["${l('end')}"]`,
    '  C --> D'
  ],
  sequence: (l) => [
    'sequenceDiagram',
    `  participant A as ${l('alice')}`,
    `  participant B as ${l('bob')}`,
    `  A->>B: ${l('request')}`,
    `  B-->>A: ${l('response')}`
  ],
  class: (l) => [
    'classDiagram',
    `  class Animal["${l('animal')}"] {`,
    `    +String ${l('name')}`,
    `    +${l('move')}()`,
    '  }',
    `  class Dog["${l('dog')}"] {`,
    `    +${l('bark')}()`,
    '  }',
    '  Animal <|-- Dog'
  ],
  state: (l) => [
    'stateDiagram-v2',
    `  state "${l('draft')}" as Draft`,
    `  state "${l('review')}" as Review`,
    `  state "${l('published')}" as Published`,
    '  [*] --> Draft',
    `  Draft --> Review : ${l('submit')}`,
    `  Review --> Draft : ${l('reject')}`,
    `  Review --> Published : ${l('approve')}`,
    '  Published --> [*]'
  ],
  er: (l) => [
    'erDiagram',
    `  CUSTOMER["${l('customer')}"] {`,
    `    string ${l('name')}`,
    '  }',
    `  ORDER["${l('order')}"] {`,
    '    int id',
    '  }',
    `  ITEM["${l('item')}"] {`,
    `    int ${l('quantity')}`,
    '  }',
    `  CUSTOMER ||--o{ ORDER : "${l('places')}"`,
    `  ORDER ||--|{ ITEM : "${l('contains')}"`
  ],
  gantt: (l) => [
    'gantt',
    `  title ${l('title')}`,
    '  dateFormat YYYY-MM-DD',
    `  section ${l('planning')}`,
    `    ${l('research')} :a1, 2026-01-05, 7d`,
    `    ${l('design')} :a2, after a1, 5d`,
    `  section ${l('execution')}`,
    `    ${l('build')} :a3, after a2, 10d`
  ],
  pie: (l) => [
    `pie title ${l('title')}`,
    `  "${l('a')}" : 45`,
    `  "${l('b')}" : 30`,
    `  "${l('c')}" : 25`
  ],
  mindmap: (l) => [
    'mindmap',
    `  root(("${l('root')}"))`,
    `    ${l('idea1')}`,
    `      ${l('detail')}`,
    `    ${l('idea2')}`
  ],
  timeline: (l) => [
    'timeline',
    `  title ${l('title')}`,
    `  2024 : ${l('event1')}`,
    `  2025 : ${l('event2')} : ${l('event3')}`
  ],
  quadrant: (l) => [
    'quadrantChart',
    `  title ${l('title')}`,
    `  x-axis "${l('lowEffort')}" --> "${l('highEffort')}"`,
    `  y-axis "${l('lowImpact')}" --> "${l('highImpact')}"`,
    `  quadrant-1 "${l('q1')}"`,
    `  quadrant-2 "${l('q2')}"`,
    `  quadrant-3 "${l('q3')}"`,
    `  quadrant-4 "${l('q4')}"`,
    `  "${l('itemA')}": [0.3, 0.6]`,
    `  "${l('itemB')}": [0.7, 0.8]`
  ]
}

/**
 * Example mermaid source (without fences) for `kind`.
 * @param t translates a key of the plugin namespace
 */
export const diagramTemplate = (kind: DiagramKind, t: (key: string) => string): string =>
  TEMPLATES[kind]((key) => t(`templates.${kind}.${key}`)).join('\n')
