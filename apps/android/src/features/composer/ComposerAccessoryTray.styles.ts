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
  composerAccessoryAction: {
    alignItems: "center",
    borderRadius: radii.medium,
    flex: 1,
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: 0,
  },
  composerAccessoryLabel: {
    color: colors.textMuted,
    maxWidth: "100%",
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    textAlign: "center",
  },
  composerAccessoryTray: {
    alignItems: "stretch",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.optical,
    marginHorizontal: conversationChromeEdgeInset,
    marginTop: spacing.xxs,
    minHeight: layoutSize.row,
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
});
