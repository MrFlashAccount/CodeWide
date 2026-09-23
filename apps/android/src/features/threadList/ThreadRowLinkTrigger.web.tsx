import { useEffect, useRef, useState, type MouseEvent } from "react";
import { View, type PointerEvent } from "react-native";

import { useEvent } from "../../react/useEvent";
import { styles } from "./ThreadRow.styles";
import {
  THREAD_ROW_LONG_PRESS_DURATION,
  THREAD_ROW_TAP_MAX_DISTANCE,
  type ThreadRowLinkTriggerProps,
} from "./ThreadRowLinkTrigger.types";

type WebTriggerProps = ThreadRowLinkTriggerProps & {
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

type PointerStart = {
  readonly id: number;
  longPressed: boolean;
  moved: boolean;
  readonly x: number;
  readonly y: number;
};

function isPrimaryUnmodifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

function shouldSuppressClick(
  start: PointerStart | null,
  event: MouseEvent<HTMLAnchorElement>,
): boolean {
  return event.detail !== 0 && (start?.moved === true || start?.longPressed === true);
}

/** Keeps the browser's actual anchor/Link semantics while rejecting drag-generated clicks. */
export function ThreadRowLinkTrigger({
  onClick,
  onLongPress,
  onPress,
  selected,
  swipeEnabled,
  ...viewProps
}: WebTriggerProps): React.JSX.Element {
  const pointer = useRef<PointerStart | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressed, setPressed] = useState(false);
  const cancelLongPress = useEvent(() => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
    }
    longPressTimer.current = null;
  });
  useEffect(() => cancelLongPress, [cancelLongPress]);
  const openMenu = useEvent(() => {
    onLongPress();
  });
  const expireLongPress = useEvent(() => {
    const start = pointer.current;
    if (start === null || start.moved) {
      return;
    }
    start.longPressed = true;
    setPressed(false);
    openMenu();
  });

  const pointerDown = useEvent((event: PointerEvent) => {
    if (event.nativeEvent.button !== 0) {
      return;
    }
    cancelLongPress();
    const start: PointerStart = {
      id: event.nativeEvent.pointerId,
      longPressed: false,
      moved: false,
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
    };
    pointer.current = start;
    setPressed(true);
    longPressTimer.current = setTimeout(expireLongPress, THREAD_ROW_LONG_PRESS_DURATION);
  });
  const pointerMove = useEvent((event: PointerEvent) => {
    const start = pointer.current;
    if (start?.id !== event.nativeEvent.pointerId || start.moved) {
      return;
    }
    const dx = event.nativeEvent.clientX - start.x;
    const dy = event.nativeEvent.clientY - start.y;
    if (Math.hypot(dx, dy) <= THREAD_ROW_TAP_MAX_DISTANCE) {
      return;
    }
    start.moved = true;
    setPressed(false);
    cancelLongPress();
  });
  const pointerUp = useEvent(() => {
    setPressed(false);
    cancelLongPress();
  });
  const pointerCancel = useEvent(() => {
    if (pointer.current !== null) {
      pointer.current.moved = true;
    }
    pointerUp();
  });
  const click = useEvent((event: MouseEvent<HTMLAnchorElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (shouldSuppressClick(start, event)) {
      event.preventDefault();
      return;
    }
    if (isPrimaryUnmodifiedClick(event)) {
      onPress?.();
    }
    onClick?.(event);
  });
  const contextMenu = useEvent((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (pointer.current?.longPressed === true) {
      return;
    }
    pointerCancel();
    openMenu();
  });

  return (
    <View
      {...viewProps}
      accessible
      {...{
        onClick: click,
        onContextMenu: contextMenu,
        onPointerCancel: pointerCancel,
        onPointerDown: pointerDown,
        onPointerLeave: pointerCancel,
        onPointerMove: pointerMove,
        onPointerUp: pointerUp,
      }}
      style={[
        styles.threadRow,
        swipeEnabled && styles.threadRowSwipeChild,
        selected && styles.threadRowSelected,
        pressed && styles.pressed,
      ]}
    />
  );
}
