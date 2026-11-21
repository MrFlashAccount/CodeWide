import type { LegendListRef } from "@legendapp/list/react-native";
import { useLayoutEffect, useRef, type Ref, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, type View } from "react-native";
import { useEvent } from "../../react/useEvent";

type PendingRestoration = {
  scrollSettled: boolean;
};

const RESTORED_ROW_VIEW_POSITION = 0.5;

type SubagentListRestorationOptions = {
  readonly itemIndex: number;
  readonly listRef: RefObject<LegendListRef | null>;
  readonly restoreFocusThreadId: string | null;
  readonly show: boolean;
};

/** Restores a hidden compact list to its selected row before returning accessibility focus. */
export function useSubagentListRestoration({
  itemIndex,
  listRef,
  restoreFocusThreadId,
  show,
}: SubagentListRestorationOptions): Ref<View> {
  const restoredRow = useRef<View | null>(null);
  const pending = useRef<PendingRestoration | null>(null);

  const focusRestoredRow = useEvent((): void => {
    const request = pending.current;
    const row = restoredRow.current;
    if (request === null || !request.scrollSettled || row === null) {
      return;
    }
    const tag = findNodeHandle(row);
    if (tag === null) {
      return;
    }
    pending.current = null;
    AccessibilityInfo.setAccessibilityFocus(tag);
  });
  const attachRestoredRow = useEvent((row: View | null): void => {
    restoredRow.current = row;
    focusRestoredRow();
  });

  useLayoutEffect(() => {
    if (!show || restoreFocusThreadId === null || itemIndex < 0) {
      pending.current = null;
      return undefined;
    }
    const list = listRef.current;
    if (list === null) {
      return undefined;
    }
    const request: PendingRestoration = {
      scrollSettled: false,
    };
    pending.current = request;
    void list
      .scrollToIndex({
        animated: false,
        index: itemIndex,
        viewPosition: RESTORED_ROW_VIEW_POSITION,
      })
      .then(
        () => {
          if (pending.current !== request) {
            return;
          }
          request.scrollSettled = true;
          focusRestoredRow();
        },
        () => {
          if (pending.current === request) {
            pending.current = null;
          }
        },
      );
    return () => {
      if (pending.current === request) {
        pending.current = null;
      }
    };
  }, [focusRestoredRow, itemIndex, listRef, restoreFocusThreadId, show]);

  return attachRestoredRow;
}
