export const UNREAD_AGENT_VISIBLE_RATIO = 0.3;

export function visibleRatioWithinViewport(
  itemY: number,
  itemHeight: number,
  viewportY: number,
  viewportHeight: number,
): number {
  if (itemHeight <= 0 || viewportHeight <= 0) return 0;
  const visibleTop = Math.max(itemY, viewportY);
  const visibleBottom = Math.min(itemY + itemHeight, viewportY + viewportHeight);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return visibleHeight / Math.min(itemHeight, viewportHeight);
}

export function shouldMarkAgentResponseRead(
  itemY: number,
  itemHeight: number,
  viewportY: number,
  viewportHeight: number,
  threshold = UNREAD_AGENT_VISIBLE_RATIO,
): boolean {
  return visibleRatioWithinViewport(itemY, itemHeight, viewportY, viewportHeight) >= threshold;
}
