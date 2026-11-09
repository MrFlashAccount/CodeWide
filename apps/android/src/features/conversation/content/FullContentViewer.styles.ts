import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
} from "../../../theme";

/** The full-screen output frame shared by the content and command output viewers. */
export const styles = StyleSheet.create({
  fullContentFooter: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  fullContentHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.sm,
  },
  fullContentHeaderIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  fullContentViewer: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  fullContentViewport: {
    backgroundColor: colors.code,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
});
