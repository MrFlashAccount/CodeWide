import type { CodeReviewDocument } from "../editorBridge";

const BISECTION_FACTOR = 2;

type Side = "old" | "new";

type DiffViewportAnchor = {
  readonly line: number;
  readonly offset: number;
  readonly side: Side;
};

/** Keeps a reading position only when switching context on the same recorded change. */
export function isDiffContextSwitch(
  previous: CodeReviewDocument | null,
  next: CodeReviewDocument | null,
): boolean {
  return (
    previous !== null &&
    next !== null &&
    previous.path === next.path &&
    (previous.fullFileDiff === true) !== (next.fullFileDiff === true) &&
    previous.patches.length > 0 &&
    previous.patches.length === next.patches.length &&
    previous.patches.every(
      (patch, index) =>
        patch.diff === next.patches[index]?.diff && patch.kind === next.patches[index]?.kind,
    )
  );
}

function* shadowElements(host: HTMLElement, selector: string): Generator<Element> {
  for (const content of host.querySelectorAll("diffs-container")) {
    if (content.shadowRoot !== null) {
      yield* content.shadowRoot.querySelectorAll(selector);
    }
  }
}

function firstVisibleRow(gutter: Element, top: number): Element | null {
  const rows = gutter.querySelectorAll("[data-column-number]");
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / BISECTION_FACTOR);
    if (rows.item(middle).getBoundingClientRect().bottom <= top) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return rows.item(low);
}

function rowSide(row: Element): Side {
  return row.getAttribute("data-line-type") === "change-deletion" ||
    row.closest("[data-deletions]") !== null
    ? "old"
    : "new";
}

/** Captures the first visible numbered line and its offset, including a partially visible line. */
export function captureDiffViewport(
  host: HTMLElement,
  viewport: HTMLElement,
): DiffViewportAnchor | null {
  const bounds = viewport.getBoundingClientRect();
  let anchor: DiffViewportAnchor | null = null;
  for (const gutter of shadowElements(host, "[data-gutter]")) {
    const row = firstVisibleRow(gutter, bounds.top);
    if (row === null) {
      continue;
    }
    const top = row.getBoundingClientRect().top;
    const offset = top - bounds.top;
    if (top < bounds.bottom && (anchor === null || offset < anchor.offset)) {
      anchor = {
        line: Number(row.getAttribute("data-column-number")),
        offset,
        side: rowSide(row),
      };
    }
  }
  return anchor;
}

function nearestRetainedRow(host: HTMLElement, anchor: DiffViewportAnchor): Element | null {
  let nearest: Element | null = null;
  let distance = Infinity;
  let matchesSide = false;
  for (const row of shadowElements(host, "[data-column-number]")) {
    const sameSide = rowSide(row) === anchor.side;
    const gap = Math.abs(Number(row.getAttribute("data-column-number")) - anchor.line);
    if ((sameSide && !matchesSide) || (sameSide === matchesSide && gap < distance)) {
      matchesSide = sameSide;
      distance = gap;
      nearest = row;
    }
  }
  return nearest;
}

function matchingRow(host: HTMLElement, anchor: DiffViewportAnchor): Element | null {
  const selector = `[data-column-number="${String(anchor.line)}"]`;
  for (const row of shadowElements(host, selector)) {
    if (rowSide(row) === anchor.side) {
      return row;
    }
  }
  return nearestRetainedRow(host, anchor);
}

/** Keeps the line fixed on screen, or anchors to the nearest retained hunk when collapsing. */
export function restoreDiffViewport(
  host: HTMLElement,
  viewport: HTMLElement,
  anchor: DiffViewportAnchor,
): void {
  const target = matchingRow(host, anchor);
  if (target !== null) {
    viewport.scrollTop +=
      target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
  }
}
