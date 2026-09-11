import { controlSize, layoutSize, spacing } from "../theme";

/** Fixed LegendList cells fit both text lines at the app's maximum font scale. */
export const threadListLayout = {
  /** Cards and sidebar controls share the same outer edge. */
  edgeInset: spacing.xs,
  rowContentHeight: layoutSize.row,
  projectRowHeight: controlSize.touch,
  rowVerticalMargin: spacing.optical,
  sectionHeight: controlSize.compact,
} as const;
