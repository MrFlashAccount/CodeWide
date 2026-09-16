import { StyleSheet } from "react-native";
import { colors, controlSize, layoutSize, radii, spacing, typeScale } from "../../theme";

const SEARCH_FOCUS_BORDER_WIDTH = 1.5;

export const styles = StyleSheet.create({
  accordionTitle: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
  },
  breadcrumbs: {
    alignItems: "center",
    paddingRight: spacing.sm,
  },
  breadcrumbViewport: {
    flex: 1,
    minWidth: 0,
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  crumbButton: { maxWidth: 220 },
  crumbGroup: {
    alignItems: "center",
    flexDirection: "row",
  },
  crumbText: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
  currentCrumb: { color: colors.text },
  disabled: { opacity: 0.5 },
  emptyState: {
    alignItems: "center",
    gap: spacing.sm,
    height: 150,
    justifyContent: "center",
  },
  emptyStateCompact: { height: 92 },
  errorText: {
    ...typeScale.body,
    color: colors.red,
  },
  footer: {
    flexShrink: 0,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  footerStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: spacing.sm,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.header,
  },
  listContent: { paddingBottom: spacing.sm },
  listFrame: {
    flex: 1,
    marginTop: spacing.sm,
    minHeight: 0,
  },
  pathActions: {
    alignItems: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  pathPanel: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    marginTop: spacing.xs,
    padding: spacing.xs,
  },
  projectScroll: {
    flex: 1,
    minHeight: 0,
  },
  projectSectionToggle: {
    alignItems: "center",
    flexDirection: "row",
    height: controlSize.regular,
    paddingHorizontal: spacing.xs,
  },
  rowAction: {
    flexShrink: 0,
    marginRight: spacing.sm,
    minHeight: controlSize.regular,
  },
  searchClear: {
    alignItems: "center",
    height: layoutSize.metadataRow,
    justifyContent: "center",
    position: "absolute",
    right: spacing.sm,
    width: layoutSize.metadataRow,
  },
  searchField: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainer,
    borderColor: "transparent",
    borderRadius: radii.medium + spacing.optical,
    borderWidth: SEARCH_FOCUS_BORDER_WIDTH,
    flexDirection: "row",
    marginTop: spacing.sm,
    minHeight: controlSize.touch,
    position: "relative",
  },
  searchFieldFocused: {
    borderColor: colors.accent,
  },
  searchIcon: {
    left: spacing.sm,
    position: "absolute",
    zIndex: 1,
  },
  searchInput: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
    minHeight: controlSize.touch,
    minWidth: 0,
    paddingLeft: controlSize.regular - spacing.xxs,
    paddingRight: controlSize.touch,
  },
  sectionCount: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  sectionLabel: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    height: controlSize.regular,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    ...typeScale.body,
    color: colors.text,
  },
  stateText: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  subtitle: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
});
