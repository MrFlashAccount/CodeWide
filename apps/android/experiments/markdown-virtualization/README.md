# Markdown virtualization browser experiment

This harness isolates the rendering boundary under discussion without starting Android. It uses the
installed `@legendapp/list/react-native` implementation through React Native Web and renders the same
deterministic Markdown AST in three modes:

- `baseline`: one Legend List item owns the complete agent response;
- `virtualized`: one outer Legend List owns every top-level Markdown block and discovers sizes;
- `virtualized-premeasured`: `expo-pretext` predicts every block height before navigation and
  Legend List receives those heights through `getFixedItemSize`.

The corpus is intentionally larger than 72,000 characters and contains headings, rich inline text,
quotes, lists, tables, and code. Historical tool calls live in a separate virtualized sheet so they do
not expand the conversation row.

Run:

```sh
pnpm --filter @codewide/android test:markdown-virtualization
```

The test writes metrics and screenshots to `test-results/markdown-virtualization/`. The absolute web
timing is a development signal, not a substitute for a later Android/Fabric device gate. The durable
contract here is that both virtualized modes mount a bounded number of Markdown blocks. The
premeasured mode additionally verifies that every visible block has stable geometry and that Legend
List can skip its size-discovery work.

`initialContentPaintMs` starts immediately before React render and ends after Legend List reports
its initial work complete, every visible block is mounted, and the browser has crossed a paint
boundary. Scroll samples use the same visible-block and paint boundary for a one-viewport move and
for cold jumps to the opposite end. They also report React work, new block render calls, the longest
frame interval, and estimated missed frames. These are browser paint proxies; Android proof still
comes from native frame metrics.

The browser path exercises `expo-pretext`'s Canvas and `Intl.Segmenter` backend. It does not prove the
Android TextPaint backend. Treat `premeasureMs` as cold resource-preparation cost and
`initialContentPaintMs` as the prepared route's render-to-paint cost; both remain visible in the
report so moving work before navigation cannot masquerade as deleting it.
