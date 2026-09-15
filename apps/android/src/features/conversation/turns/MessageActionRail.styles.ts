import { StyleSheet } from "react-native";
import { controlSize, radii } from "../../../theme";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  messageActionRail: {
    width: controlSize.compact,
    minHeight: controlSize.compact,
    flexShrink: 0,
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  messageActionButton: {
    width: controlSize.compact,
    height: controlSize.compact,
    flexShrink: 0,
    alignItems: "flex-start",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  copyButton: {
    width: controlSize.compact,
    height: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  copyButtonCompact: {
    width: controlSize.compact,
    height: controlSize.compact,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.small,
  },
});
