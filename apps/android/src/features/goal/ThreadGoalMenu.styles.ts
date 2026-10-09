import { StyleSheet } from "react-native";

import { colors, menuContentInset, radii, spacing, touchTarget, typeScale } from "../../theme";

const DISABLED_OPACITY = 0.4;

export const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  actionPressed: { backgroundColor: colors.menuHighlight },
  anchor: {
    flexShrink: 0,
  },
  disabled: { opacity: DISABLED_OPACITY },
  error: {
    color: colors.red,
    ...typeScale.label,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: menuContentInset,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
  },
  heading: {
    color: colors.text,
    ...typeScale.title,
  },
  metadata: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  metadataRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  objective: {
    color: colors.text,
    ...typeScale.body,
  },
  section: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: menuContentInset,
  },
});
