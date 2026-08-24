/** Keep the exact finite row-top offset. A single Markdown/tool row can be
 * taller than the viewport by tens of thousands of pixels, so an arbitrary
 * clamp silently changes the semantic restore position. */
export function sanitizeHistoryAnchorOffset(offset: number | null): number | null {
  return offset === null || !Number.isFinite(offset) ? null : offset;
}

/**
 * The list reports whether the viewport is at the end. Persisting the mutable
 * end as a semantic history position races optimistic -> canonical and live ->
 * sealed handoffs, so only stable rows away from the end are resumable.
 *
   * A semantic anchor is therefore valid only inside a bounded historical
   * window, and never while the anchor turn itself is still mutable.
 */
export function isPersistableHistoryAnchor({
  atEnd,
  anchorTurnId,
  anchorTurnStatus,
  activeTurnId,
}: {
  atEnd: boolean;
  anchorTurnId: string | null;
  anchorTurnStatus: string | null;
  activeTurnId: string | null;
}): boolean {
  return !atEnd
    && anchorTurnId !== null
    && anchorTurnStatus !== "inProgress"
    && anchorTurnId !== activeTurnId;
}
