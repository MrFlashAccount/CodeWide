import { StyleSheet } from "react-native";
import { colors, layoutSize, radii, spacing, touchTarget, typeScale } from "../../../theme";
import { conversationChromeEdgeInset } from "../../../ui/conversation-chrome-layout";

export const styles = StyleSheet.create({
  conversationHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 0,
    minHeight: layoutSize.header,
    paddingHorizontal: conversationChromeEdgeInset,
  },
  conversationHeaderTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  conversationIdentity: {
    flex: 1,
    minWidth: 0,
  },
  conversationIdentityRaised: {
    marginLeft: spacing.xs,
    transform: [{ translateY: spacing.optical }],
  },
  conversationTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  conversationTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    minWidth: 0,
  },
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
});
