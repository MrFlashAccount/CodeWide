const READ_VISIBILITY_FRACTION = 0.5;

export function visibleHeightWithinViewport(
  itemY: number,
  itemHeight: number,
  viewportY: number,
  viewportHeight: number,
): number {
  if (itemHeight <= 0 || viewportHeight <= 0) {
    return 0;
  }
  const visibleTop = Math.max(itemY, viewportY);
  const visibleBottom = Math.min(itemY + itemHeight, viewportY + viewportHeight);
  return Math.max(0, visibleBottom - visibleTop);
}

export function requiredAgentResponseVisibleHeight(
  itemHeight: number,
  viewportHeight: number,
): number {
  if (itemHeight <= 0 || viewportHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const halfViewport = viewportHeight * READ_VISIBILITY_FRACTION;
  if (itemHeight <= halfViewport) {
    return itemHeight;
  }
  return Math.min(itemHeight * READ_VISIBILITY_FRACTION, halfViewport);
}

export function shouldMarkAgentResponseRead(
  itemY: number,
  itemHeight: number,
  viewportY: number,
  viewportHeight: number,
): boolean {
  return (
    visibleHeightWithinViewport(itemY, itemHeight, viewportY, viewportHeight) >=
    requiredAgentResponseVisibleHeight(itemHeight, viewportHeight)
  );
}

/** Atomically decides whether one async visibility path owns the receipt. */
export function claimUnreadReceipt(
  currentReceiptKey: string | null,
  acknowledgedReceiptKey: string | null,
  requestedReceiptKey: string,
): string | null {
  if (currentReceiptKey !== requestedReceiptKey) {
    return null;
  }
  if (acknowledgedReceiptKey === requestedReceiptKey) {
    return null;
  }
  return requestedReceiptKey;
}
