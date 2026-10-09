import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  hidden: { display: "none" },
  host: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  workspace: { flex: 1 },
});
