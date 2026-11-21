import type { LegendListRef } from "@legendapp/list/react-native";

const MAX_RESTORE_LAYOUT_FRAMES = 8;
const STABLE_RESTORE_LAYOUT_FRAMES = 3;

type ReadingRow = { readonly index: number; readonly top: number };
type ReadingTarget = { readonly index: number; readonly viewOffset: number };
type Bounds = { readonly bottom: number; readonly top: number };
function hasBounds(view: unknown): view is { getBoundingClientRect: () => Bounds } {
  return (
    typeof view === "object" &&
    view !== null &&
    "getBoundingClientRect" in view &&
    typeof view.getBoundingClientRect === "function"
  );
}

function wrapsScrollHost(view: unknown): view is { getNativeScrollRef: () => unknown } {
  return (
    typeof view === "object" &&
    view !== null &&
    "getNativeScrollRef" in view &&
    typeof view.getNativeScrollRef === "function"
  );
}

/** Reads committed Fabric/DOM bounds at gesture settlement, including header and content padding. */
export function timelineReadingRow(list: LegendListRef | null, inset: number): ReadingRow | null {
  if (list === null) {
    return null;
  }
  const viewport = list.getNativeScrollRef();
  const host: unknown = wrapsScrollHost(viewport) ? viewport.getNativeScrollRef() : viewport;
  if (!hasBounds(host)) {
    return null;
  }
  const bounds = host.getBoundingClientRect();
  const state = list.getState();
  // After a fling the estimated visible range can lag the native viewport by several rows.
  // Inspect the mounted buffer so an estimate cannot substitute a row lower on screen.
  for (let index = Math.max(0, state.startBuffered); index <= state.endBuffered; index++) {
    const element: unknown = state.elementAtIndex(index);
    if (!hasBounds(element)) {
      continue;
    }
    const row = element.getBoundingClientRect();
    if (row.bottom > bounds.top + inset && row.top < bounds.bottom) {
      return { index, top: row.top - bounds.top };
    }
  }
  return null;
}

/** Waits for Fabric to settle the requested bookmark or the naturally clamped unread position.
 * Near an extent a smaller viewport can clamp a formerly valid offset. Leave that native clamp
 * in place once the initial layout budget is exhausted. This never issues a scroll command. */
export async function waitForReadingRow(
  list: { readingRow?: (inset: number) => ReturnType<typeof timelineReadingRow> },
  target: ReadingTarget | null,
  inset: number,
): Promise<void> {
  const read = list.readingRow;
  if (read === undefined) {
    return;
  }
  let matches = 0;
  let previous: ReturnType<typeof timelineReadingRow> = null;
  for (let frame = 0; frame < MAX_RESTORE_LAYOUT_FRAMES; frame++) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    const row = read(inset);
    const atTarget = matchesReadingTarget(row, target);
    if (atTarget && row.index === previous?.index && row.top === previous.top) {
      matches++;
    } else {
      matches = 1;
    }
    previous = row;
    if (matches === STABLE_RESTORE_LAYOUT_FRAMES) {
      return;
    }
  }
}

function matchesReadingTarget(
  row: ReadingRow | null,
  target: ReadingTarget | null,
): row is ReadingRow {
  return (
    row !== null &&
    (target === null || (row.index === target.index && Math.abs(row.top - target.viewOffset) <= 1))
  );
}
