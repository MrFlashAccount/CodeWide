import { StyleSheet } from "react-native";
import { colors, controlSize, layoutSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  header: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
  subtitle: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  pathPanel: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  pathActions: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  breadcrumbs: {
    alignItems: "center",
    paddingRight: spacing.sm,
  },
  crumbGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  breadcrumbViewport: {
    flex: 1,
    minWidth: 0,
  },
  crumbButton: { maxWidth: 220 },
  crumbText: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
  currentCrumb: { color: colors.text },
  searchField: { marginTop: spacing.sm },
  listFrame: {
    flex: 1,
    minHeight: 0,
    marginTop: spacing.sm,
  },
  projectScroll: {
    flex: 1,
    minHeight: 0,
  },
  listContent: { paddingBottom: spacing.sm },
  sectionLabel: {
    height: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    ...typeScale.body,
    color: colors.text,
  },
  sectionCount: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  accordionTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  projectSectionToggle: {
    height: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
  },
  rowAction: {
    minHeight: controlSize.regular,
    flexShrink: 0,
    marginRight: spacing.sm,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyState: {
    height: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  emptyStateCompact: { height: 92 },
  stateText: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  footer: {
    flexShrink: 0,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerStatus: {
    minHeight: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  errorText: {
    ...typeScale.body,
    color: colors.red,
  },
  disabled: { opacity: 0.5 },
});
