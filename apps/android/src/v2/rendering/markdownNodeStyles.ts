import { StyleSheet, type TextStyle } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../theme";

export const markdownNodeStyles = StyleSheet.create({
  alert: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    gap: spacing.xxs,
    padding: spacing.xs,
    width: "100%",
  },
  alertTitle: { ...typeScale.label, fontWeight: typeWeight.semibold },
  blockquote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 2,
    gap: spacing.xxs,
    paddingLeft: spacing.xs,
  },
  footnote: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
    paddingTop: spacing.xs,
    width: "100%",
  },
  footnoteBody: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  footnoteMarker: { color: colors.accent, ...typeScale.caption },
  heading: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
    marginTop: spacing.xxs,
  },
  headingLarge: { ...typeScale.title },
  headingSmall: { ...typeScale.body },
  list: { alignSelf: "flex-start", gap: spacing.xxs, minWidth: 0 },
  listBody: { flexShrink: 1, gap: spacing.optical, minWidth: 0 },
  listMarker: { color: colors.textMuted, ...typeScale.body, textAlign: "right", width: 19 },
  listRow: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  paragraph: { color: colors.text, ...typeScale.body, minWidth: 0 },
  rawHtml: { color: colors.textMuted, ...typeScale.code },
  rule: { height: spacing.xs },
  secondary: { color: colors.textMuted },
});

export function markdownHeadingStyle(depth: 1 | 2 | 3 | 4 | 5 | 6): TextStyle {
  return depth === 1 || depth === 2
    ? markdownNodeStyles.headingLarge
    : markdownNodeStyles.headingSmall;
}
