import { StyleSheet } from "react-native";
import { controlSize, radii } from "../../../theme";

export const styles = StyleSheet.create({
  copyButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  copyButtonCompact: {
    alignItems: "center",
    borderRadius: radii.small,
    height: controlSize.compact,
    justifyContent: "center",
    width: controlSize.compact,
  },
  messageActionButton: {
    alignItems: "flex-start",
    flexShrink: 0,
  },
  messageActionRail: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    flexShrink: 0,
    minHeight: controlSize.compact,
    width: controlSize.compact,
  },
});
