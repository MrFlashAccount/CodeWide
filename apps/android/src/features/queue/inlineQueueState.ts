import { useEffect, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { useWindowDimensions } from "react-native";
import { useEvent } from "../../react/useEvent";
import { controlSize } from "../../theme";
import type { InlineQueueOverlayItem, InlineQueueOverlayProps } from "./inlineQueueContract";
import { calculateQueueLayouts } from "./inlineQueueLayout";

export function useInlineQueueOverlay(props: InlineQueueOverlayProps) {
  const { expanded, items, maxHeight, onClose, onMove, onRefresh } = props;

  const { width: viewportWidth } = useWindowDimensions();
  const listRef = useRef<ScrollView>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const refresh = useEvent(async (): Promise<void> => {
    if (onRefresh !== undefined) {
      await onRefresh();
    }
  });
  const run = useEvent(
    async (
      itemId: string,
      action: () => Promise<void>,
      closeAfterSuccess: boolean,
    ): Promise<boolean> => {
      if (busyId !== null) {
        return false;
      }
      setBusyId(itemId);
      setActionError(null);
      try {
        await action();
        await refresh();
        setBusyId(null);
        if (closeAfterSuccess) {
          onClose();
        }
        return true;
      } catch (error: unknown) {
        setBusyId(null);
        setActionError(error instanceof Error ? error.message : "Queue action failed");
        return false;
      }
    },
  );
  const activate = useEvent(
    (itemId: string, action: () => Promise<void>, closeAfterSuccess: boolean): void => {
      run(itemId, action, closeAfterSuccess).catch((error: unknown) => {
        setBusyId(null);
        setActionError(error instanceof Error ? error.message : "Queue action failed");
      });
    },
  );
  const moveBy = useEvent(
    async (item: InlineQueueOverlayItem, index: number, offset: number): Promise<void> => {
      if (onMove === undefined || item.state !== "queued") {
        return;
      }
      const target = Math.max(0, Math.min(items.length - 1, index + offset));
      const direction: -1 | 1 = target < index ? -1 : 1;
      let operation = Promise.resolve();
      for (let step = 0; step < Math.abs(target - index); step += 1) {
        operation = operation.then(async () => onMove(item.id, direction));
      }
      await operation;
    },
  );
  const measureItem = useEvent((itemId: string, height: number): void => {
    setMeasuredHeights((current) => {
      if (current.get(itemId) === height) {
        return current;
      }
      const next = new Map(current);
      next.set(itemId, height);
      return next;
    });
  });
  const busy = busyId !== null;
  const listMaxHeight = Math.max(controlSize.touch * 2, maxHeight);
  const { contentHeight, layouts } = calculateQueueLayouts(items, measuredHeights, expanded);

  useEffect(() => {
    if (expanded) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, [contentHeight, expanded]);
  return {
    actionError,
    activate,
    busy,
    busyId,
    contentHeight,
    layouts,
    listMaxHeight,
    listRef,
    measureItem,
    moveBy,
    openMenuId,
    run,
    setOpenMenuId,
    viewportWidth,
  };
}
