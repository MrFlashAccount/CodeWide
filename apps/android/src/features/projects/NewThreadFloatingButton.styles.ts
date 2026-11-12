import { StyleSheet } from "react-native";
import { colors } from "../../theme";

/** Diameter of the primary New thread action; the floating stack aligns to its axis. */
export const NEW_THREAD_FAB_SIZE = 56;

export const styles = StyleSheet.create({
  newThreadFab: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: NEW_THREAD_FAB_SIZE / 2,
    elevation: 3,
    height: NEW_THREAD_FAB_SIZE,
    justifyContent: "center",
    width: NEW_THREAD_FAB_SIZE,
  },
  pressed: { opacity: 0.68 },
});
