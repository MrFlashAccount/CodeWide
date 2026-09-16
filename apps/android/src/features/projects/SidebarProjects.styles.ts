import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";

export const SECTION_HEIGHT = controlSize.touch + spacing.sm;

export const styles = StyleSheet.create({
  archiveCrumb: {
    color: colors.textMuted,
    ...typeScale.caption,
    flexShrink: 0,
  },
  back: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: controlSize.touch,
  },
  breadcrumbs: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    minWidth: 0,
  },
  crumbSeparator: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  crumbText: {
    color: colors.text,
    ...typeScale.title,
  },
  disabled: { opacity: 0.35 },
  empty: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.md,
  },
  error: {
    color: colors.red,
    ...typeScale.body,
    paddingVertical: spacing.sm,
  },
  headerAction: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  menuSlot: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: controlSize.touch,
  },
  name: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  project: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  projectCrumb: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    height: SECTION_HEIGHT,
    justifyContent: "center",
    paddingTop: spacing.sm,
  },
  sectionCount: {
    color: colors.textDim,
    ...typeScale.caption,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingVertical: spacing.sm,
  },
  sectionToggle: {
    alignItems: "center",
    flexDirection: "row",
    height: controlSize.touch,
    justifyContent: "space-between",
  },
  serverCrumb: {
    flexShrink: 1,
    justifyContent: "center",
    maxWidth: "35%",
    minHeight: controlSize.touch,
  },
  serverLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    maxWidth: "45%",
    ...typeScale.label,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
    paddingBottom: spacing.sm,
  },
  sheetList: { flex: 1 },
  sheetListContent: { paddingBottom: spacing.md },
  sheetTitle: {
    color: colors.text,
    flex: 1,
    ...typeScale.title,
    fontWeight: typeWeight.semibold,
  },
  shortcut: {
    gap: spacing.xs,
    height: threadListLayout.projectRowHeight,
    marginHorizontal: threadListLayout.edgeInset,
    paddingHorizontal: spacing.xs,
  },
  shortcutIdentity: {
    alignItems: "baseline",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  shortcutPressed: { opacity: 0.68 },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  unread: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: spacing.xs,
    width: spacing.xs,
  },
  unreadSlot: {
    alignItems: "center",
    width: spacing.sm,
  },
});
