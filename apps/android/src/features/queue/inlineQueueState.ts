import { useEffect, useRef, useState } from "react";
import { ScrollView, useWindowDimensions } from "react-native";
import { useEvent } from "../../react/useEvent";
import { controlSize } from "../../theme";
import type { InlineQueueOverlayItem, InlineQueueOverlayProps } from "./inlineQueueContract";
import { calculateQueueLayouts } from "./inlineQueueLayout";

export function useInlineQueueOverlay(props: InlineQueueOverlayProps) {
  const { maxHeight, expanded, items, onClose, onMove, onRefresh } = props;

  const { width: viewportWidth } = useWindowDimensions();
  const listRef = useRef<ScrollView>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refresh = useEvent((): Promise<unknown> =>
    onRefresh === undefined ? Promise.resolve() : onRefresh(),
  );
  const run = useEvent(
    async (
      itemId: string,
      action: () => Promise<void>,
      closeAfterSuccess: boolean,
    ): Promise<boolean> => {
      if (busyId !== null) return false;
      setBusyId(itemId);
      setActionError(null);
      try {
        await action();
        await refresh();
        setBusyId(null);
        if (closeAfterSuccess) onClose();
        return true;
      } catch (cause: unknown) {
        setBusyId(null);
        setActionError(cause instanceof Error ? cause.message : "Queue action failed");
        return false;
      }
    },
  );
  const moveBy = useEvent(
    (item: InlineQueueOverlayItem, index: number, offset: number): Promise<void> => {
      if (onMove === undefined || item.state !== "queued") return Promise.resolve();
      const target = Math.max(0, Math.min(items.length - 1, index + offset));
      const direction: -1 | 1 = target < index ? -1 : 1;
      let operation = Promise.resolve();
      for (let step = 0; step < Math.abs(target - index); step += 1) {
        operation = operation.then(() => onMove(item.id, direction));
      }
      return operation;
    },
  );
  const measureItem = useEvent((itemId: string, height: number): void => {
    setMeasuredHeights((current) => {
      if (current.get(itemId) === height) return current;
      const next = new Map(current);
      next.set(itemId, height);
      return next;
    });
  });
  const busy = busyId !== null;
  const listMaxHeight = Math.max(controlSize.touch * 2, maxHeight);
  const { contentHeight, layouts } = calculateQueueLayouts(items, measuredHeights, expanded);

  useEffect(() => {
    if (expanded) listRef.current?.scrollToEnd({ animated: false });
  }, [contentHeight, expanded]);
  return {
    viewportWidth,
    listRef,
    busyId,
    actionError,
    openMenuId,
    setOpenMenuId,
    run,
    moveBy,
    measureItem,
    busy,
    listMaxHeight,
    contentHeight,
    layouts,
  };
}
