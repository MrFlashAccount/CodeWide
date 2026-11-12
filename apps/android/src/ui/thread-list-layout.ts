import { controlSize, layoutSize, spacing } from "../theme";

/** Fixed LegendList cells fit both text lines at the app's maximum font scale. */
export const threadListLayout = {
  /**
   * Text column of catalog cards: the card edge plus its content inset. Section
   * headers and the list header align their text to this column.
   */
  cardContentInset: spacing.sm,
  /** Selection surface edge of catalog cards; wider than `edgeInset` so the content clears the rounding. */
  cardEdgeInset: spacing.xxs,
  /** Cards and sidebar controls share the same outer edge. */
  edgeInset: spacing.xs,
  projectRowHeight: controlSize.touch,
  rowContentHeight: layoutSize.row,
  rowVerticalMargin: spacing.optical,
  sectionHeight: controlSize.compact,
} as const;
