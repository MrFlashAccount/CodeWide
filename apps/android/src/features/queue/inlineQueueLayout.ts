import { formatDeviceTime } from "../../data/device-time";
import { controlSize, spacing } from "../../theme";
import type { InlineQueueOverlayItem, QueueLayout } from "./inlineQueueContract";

export const STACK_VISIBLE_ITEMS = 2;

export const STACK_HEIGHT = controlSize.regular;

export const STACK_VIEWPORT_HEIGHT = controlSize.touch;

export const STACK_OFFSET = spacing.xxs;

export const CARD_GAP = spacing.optical;

export const SWIPE_REVEAL = 72;

export const ENTRY_OFFSET = 16;

export const CARD_BORDER_WIDTH = 1;

export function formatQueueTime(createdAtMilliseconds: number): string {
  return formatDeviceTime(createdAtMilliseconds / 1000);
}

export function calculateQueueLayouts(
  items: readonly InlineQueueOverlayItem[],
  measuredHeights: ReadonlyMap<string, number>,
  expanded: boolean,
): { readonly contentHeight: number; readonly layouts: readonly QueueLayout[] } {
  const layouts: QueueLayout[] = [];
  let expandedOffset = 0;
  for (const [index, item] of items.entries()) {
    const height = measuredHeights.get(item.id) ?? STACK_HEIGHT;
    layouts.push({
      height,
      item,
      targetOpacity: expanded || index < STACK_VISIBLE_ITEMS ? 1 : 0,
      targetScale: expanded ? 1 : Math.max(0.9, 1 - index * 0.05),
      targetY: expanded
        ? -expandedOffset
        : -Math.min(index, STACK_VISIBLE_ITEMS - 1) * STACK_OFFSET,
    });
    expandedOffset += height + CARD_GAP;
  }
  const contentHeight = expanded
    ? Math.max(STACK_VIEWPORT_HEIGHT, expandedOffset - (items.length > 0 ? CARD_GAP : 0))
    : STACK_VIEWPORT_HEIGHT;
  return { contentHeight, layouts };
}
