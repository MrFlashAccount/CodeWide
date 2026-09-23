import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { useEvent } from "../react/useEvent";
import { colors, spacing } from "../theme";
import type { AppNoticeRequest } from "./appNoticeContext";
import { AppNoticeContent } from "./AppNoticeContent";
import { appNoticeStore, type NoticeEntry } from "./appNoticeStore";
import { useAppNoticeMotion } from "./appNoticeMotion";
import { useAppNoticeLifetime } from "./useAppNoticeLifetime";

const CARD_Z_INDEX_BASE = 50;
const CARD_RADIUS = 18;
const CARD_PADDING_Y = 14;
const CARD_ELEVATION = 10;
const CARD_SHADOW_Y = 10;
const CARD_SHADOW_OPACITY = 0.45;
const CARD_SHADOW_RADIUS = 20;

interface AppNoticeCardProps {
  readonly entry: NoticeEntry;
  readonly expanded: boolean;
  readonly index: number;
  readonly interacting: boolean;
  readonly offset: number;
  readonly onHeight: (id: number, height: number) => void;
  readonly onInteractingChange: (interacting: boolean) => void;
  readonly onToggleExpanded: () => void;
  readonly visible: boolean;
}

/** Measures a toast and composes its lifetime, motion, and interaction owners. */
export function AppNoticeCard({
  entry,
  expanded,
  index,
  interacting,
  offset,
  onHeight,
  onInteractingChange,
  onToggleExpanded,
  visible,
}: AppNoticeCardProps): React.JSX.Element {
  const { request } = entry;
  const [height, setHeight] = useState(0);
  const remove = useEvent(() => {
    appNoticeStore.dismiss(entry.id);
  });
  const motion = useAppNoticeMotion({
    expanded,
    height,
    index,
    offset,
    onInteractingChange,
    onSwipeDismiss: remove,
    visible,
  });
  const expire = useEvent(() => {
    motion.close();
  });
  useAppNoticeLifetime({
    duration: request.duration,
    onExpire: expire,
    paused: expanded || interacting,
  });

  const measure = useEvent((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight <= 0) {
      return;
    }
    setHeight(nextHeight);
    onHeight(entry.id, nextHeight);
  });
  const activate = useEvent((event: GestureResponderEvent) => {
    event.stopPropagation();
    if (motion.close()) {
      request.onActionPress?.();
    }
  });
  const dismiss = useEvent(() => {
    motion.close();
  });
  const expandStack = useEvent(() => {
    onToggleExpanded();
  });
  useEffect(
    () => () => {
      onHeight(entry.id, 0);
    },
    [entry.id, onHeight],
  );

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.wrapper, { zIndex: CARD_Z_INDEX_BASE - index }, motion.style]}
    >
      <GestureDetector gesture={motion.pan}>
        <NoticePressable
          onAction={activate}
          onDismiss={dismiss}
          onExpand={expandStack}
          onMeasure={measure}
          request={request}
        />
      </GestureDetector>
    </Animated.View>
  );
}

function NoticePressable({
  onAction,
  onDismiss,
  onExpand,
  onMeasure,
  request,
}: {
  readonly onAction: (event: GestureResponderEvent) => void;
  readonly onDismiss: () => void;
  readonly onExpand: () => void;
  readonly onMeasure: (event: LayoutChangeEvent) => void;
  readonly request: AppNoticeRequest;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityActions={[{ label: "Dismiss notification", name: "dismiss" }]}
      accessibilityLabel={request.label}
      accessibilityRole="alert"
      onAccessibilityAction={onDismiss}
      onLayout={onMeasure}
      onPress={onExpand}
      style={styles.card}
    >
      <AppNoticeContent onAction={onAction} request={request} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: CARD_ELEVATION,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: CARD_PADDING_Y,
    shadowColor: colors.background,
    shadowOffset: {
      height: CARD_SHADOW_Y,
      width: 0,
    },
    shadowOpacity: CARD_SHADOW_OPACITY,
    shadowRadius: CARD_SHADOW_RADIUS,
  },
  wrapper: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
