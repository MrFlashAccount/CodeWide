import { StyleSheet } from "react-native";
import { colors, layoutSize, radii, spacing, touchTarget, typeScale } from "../../../theme";
import { conversationChromeEdgeInset } from "../../../ui/conversation-chrome-layout";

export const styles = StyleSheet.create({
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  conversationHeader: {
    minHeight: layoutSize.header,
    paddingHorizontal: conversationChromeEdgeInset,
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  conversationIdentity: {
    flex: 1,
    minWidth: 0,
  },
  conversationIdentityRaised: {
    marginLeft: spacing.xs,
    transform: [{ translateY: spacing.optical }],
  },
  conversationTitleRow: {
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  conversationTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  conversationHeaderTitle: {
    minWidth: 0,
    flexShrink: 1,
  },
});
