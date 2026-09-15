import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  layoutSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../theme";
import { conversationChromeEdgeInset } from "../../ui/conversation-chrome-layout";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  composerAccessoryTray: {
    minHeight: layoutSize.row,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.optical,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainer,
  },
  composerAccessoryAction: {
    minWidth: 0,
    minHeight: controlSize.touch,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radii.medium,
  },
  composerAccessoryLabel: {
    maxWidth: "100%",
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    textAlign: "center",
  },
  disabled: { opacity: 0.42 },
});
