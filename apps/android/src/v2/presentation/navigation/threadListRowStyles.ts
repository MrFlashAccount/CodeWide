import {
  StyleSheet,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";

export function selectedThreadStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  const { pressed } = state;
  return [
    threadListRowStyles.thread,
    threadListRowStyles.threadSelected,
    pressed && threadListRowStyles.pressed,
  ];
}

export function unselectedThreadStyle(state: PressableStateCallbackType): StyleProp<ViewStyle> {
  const { pressed } = state;
  return [threadListRowStyles.thread, pressed && threadListRowStyles.pressed];
}

export const threadListRowStyles = StyleSheet.create({
  contextMenu: {
    alignSelf: "stretch",
    flexShrink: 1,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  pressed: { opacity: 0.68 },
  preview: { flex: 1, ...typeScale.label },
  previewRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  swipeChildren: { backgroundColor: colors.surface },
  swipeContainer: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    marginHorizontal: spacing.xs,
    marginVertical: spacing.optical,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  thread: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  threadCopy: { flex: 1, gap: spacing.optical, minWidth: 0 },
  threadMeta: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: spacing.xs },
  threadSelected: { backgroundColor: colors.secondaryContainer },
  time: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
    minWidth: 48,
    textAlign: "right",
  },
  title: { flexShrink: 1, ...typeScale.body, maxWidth: "100%", minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  titleShimmer: { alignSelf: "stretch" },
  titleSlot: { alignItems: "flex-start", flex: 1, minWidth: 0 },
  unreadDot: { backgroundColor: colors.accent, borderRadius: spacing.xxs, height: 7, width: 7 },
  unreadSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 7,
  },
});
