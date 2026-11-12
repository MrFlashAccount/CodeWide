import { StyleSheet } from "react-native";
import {
  colors,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeTracking,
  typeWeight,
} from "../../theme";

const DISABLED_OPACITY = 0.45;
const SELECTED_BORDER_WIDTH = 1.5;
const AGENT_CHECK_SIZE = 20;

export const styles = StyleSheet.create({
  forkAction: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  forkAgentCard: {
    backgroundColor: colors.surfaceContainer,
    borderColor: "transparent",
    borderRadius: radii.large,
    borderWidth: SELECTED_BORDER_WIDTH,
    flex: 1,
    gap: spacing.xxs,
    padding: spacing.md,
  },
  forkAgentCardDisabled: {
    opacity: DISABLED_OPACITY,
  },
  forkAgentCards: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  forkAgentCardSelected: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.accent,
  },
  forkAgentCheck: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: AGENT_CHECK_SIZE,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    top: spacing.md,
    width: AGENT_CHECK_SIZE,
  },
  forkAgentDetail: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  forkAgentHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingRight: AGENT_CHECK_SIZE + spacing.xs,
  },
  forkAgentName: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
  forkAgentOutcome: {
    ...typeScale.title,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  forkButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.lg,
  },
  forkButtonPressed: {
    backgroundColor: colors.accentPressed,
  },
  forkButtonText: {
    ...typeScale.title,
    color: colors.onPrimary,
  },
  forkCaption: {
    ...typeScale.label,
    color: colors.textDim,
    textAlign: "center",
  },
  forkContext: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  forkContextText: {
    ...typeScale.body,
    color: colors.textMuted,
    flexShrink: 1,
  },
  forkHandoffNote: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  forkHandoffText: {
    ...typeScale.body,
    color: colors.textMuted,
    flex: 1,
  },
  forkHeader: {
    gap: spacing.xs,
  },
  forkModelRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  forkSection: {
    gap: spacing.sm,
  },
  forkSectionLabel: {
    ...typeScale.label,
    color: colors.textDim,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
  forkSheet: {
    gap: spacing.xl,
    paddingBottom: spacing.lg,
    // With the sheet's own inset this keeps the prototype's 32dp side margin.
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  headerMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  sheetEmpty: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
});
