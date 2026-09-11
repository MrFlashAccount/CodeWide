# Native HTML and math in V1 messages

`RichMarkdown` keeps its existing parser/render path for ordinary Markdown and
short previews. Messages containing actual HTML or math use Marked to produce
HTML and `@native-html/render` to parse it and render native Text/View trees.
Literal HTML inside code, escaped delimiters, and ordinary currency remain text.
There is no second application-owned HTML AST or general-purpose HTML renderer.

Application adapters own only behavior the library cannot supply:

- `details`/`summary`: nested native disclosures; expansion survives streamed updates.
- `pre`: existing code/Mermaid rendering and distinct review paths.
- Images, links and media: existing authenticated file/navigation capabilities.
- Tables: measured native cells, horizontal scrolling, colspan/rowspan, including
  zero rowspan restricted to the current row group. The available alpha native
  table plugin does not implement that zero-span behavior, so it is not installed.
- Form examples: read-only text/checkmarks/progress, never executable forms.
- Math: lazy-loaded MathJax TeX-to-SVG rendered by `react-native-svg`, not WebView.

Math accepts `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, and math/tex/latex code
fences. Base, AMS and macro commands are enabled; malformed or unsupported TeX
stays visible as source. Each conversion has a fresh macro environment. SVG paths
contain their glyphs and do not request remote fonts.

This is a message renderer, not a browser: scripts, document metadata, iframes,
embedded documents and arbitrary HTML SVG/canvas are omitted. Inline CSS is
ignored in favor of application typography and geometry. Audio/video elements
open through the existing file capability; they do not start separate downloads.
Full browser HTML/CSS behavior and arbitrary LaTeX packages are not promised.
The separate V2 renderer is not changed by this implementation.

## Checks

```sh
pnpm exec vitest run packages/rendering-core/test/message-markup.test.ts
pnpm --filter @codewide/android test:markup
pnpm --filter @codewide/rendering-core typecheck
pnpm --filter @codewide/android typecheck
pnpm --filter @codewide/android lint
```

The native component suite exercises the real HTML engine, disclosures, code and
file capabilities, table layout and SVG math. Jest uses the React Native framework
preset and a test-only dynamic-import transform; project modules are not mocked.
