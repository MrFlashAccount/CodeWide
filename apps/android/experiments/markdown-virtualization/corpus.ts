const TARGET_CONTENT_CHARS = 76_000;

const SECTION_TEMPLATE = (index: number) => `
## Rendering checkpoint ${String(index)}

The conversation stays responsive when **layout work is bounded** to the visible viewport. This paragraph mixes _emphasis_, \`inline code\`, and a [local reference](#checkpoint-${String(index)}) so the renderer creates a realistic inline tree instead of one plain text node.

> The important invariant is stable geometry: a block may be measured later, but the visible anchor must not jump while older content is mounted.

- keep one outer scroll owner
- reserve space before expensive media is decoded
- move historical tool details into a separate sheet

1. parse the durable source
2. expose top-level render units
3. let Legend List mount only the viewport

| signal | expected value | section |
| --- | ---: | ---: |
| mounted blocks | bounded | ${String(index)} |
| source characters | durable | ${String(index * 317)} |

\`\`\`ts
const checkpoint${String(index)} = {
  anchor: "stable",
  layout: "viewport-only",
  section: ${String(index)},
};
\`\`\`

The final sentence deliberately varies by section (${String(index * 7919)}) so parser caches cannot collapse the corpus into a single repeated source value.
`;

/** Builds a deterministic, non-private corpus large enough to expose whole-turn rendering work. */
export function createMarkdownVirtualizationCorpus(): string {
  let source = "# Large conversation response\n";
  let section = 1;
  while (source.length < TARGET_CONTENT_CHARS) {
    source += SECTION_TEMPLATE(section);
    section += 1;
  }
  return source;
}
