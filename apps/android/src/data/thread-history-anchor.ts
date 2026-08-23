/** Keep the exact finite row-top offset. A single Markdown/tool row can be
 * taller than the viewport by tens of thousands of pixels, so an arbitrary
 * clamp silently changes the semantic restore position. */
export function sanitizeHistoryAnchorOffset(offset: number | null): number | null {
  return offset === null || !Number.isFinite(offset) ? null : offset;
}
