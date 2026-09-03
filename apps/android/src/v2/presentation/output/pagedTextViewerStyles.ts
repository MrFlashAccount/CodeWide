import { StyleSheet } from "react-native";

import { colors, spacing, touchTarget } from "../../theme";

export const pagedTextViewerStyles = StyleSheet.create({
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  close: {
    alignItems: "center",
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  content: { gap: spacing.sm, padding: spacing.sm },
  header: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: touchTarget,
    paddingLeft: spacing.sm,
  },
  loadMore: { alignItems: "center", justifyContent: "center", minHeight: touchTarget },
  screen: { backgroundColor: colors.background, flex: 1 },
  title: { flex: 1 },
});
