import { StyleSheet } from "react-native";

import {
  FLOATING_ACTION_Z_INDEX,
  PRIMARY_FAB_PLACEMENT,
  SECONDARY_FAB_ABOVE_PRIMARY,
  SECONDARY_FAB_ALONE,
} from "./threadListFabGeometry";

export const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: FLOATING_ACTION_Z_INDEX,
  },
  primary: {
    ...PRIMARY_FAB_PLACEMENT,
    position: "absolute",
  },
  secondaryAbovePrimary: {
    ...SECONDARY_FAB_ABOVE_PRIMARY,
    position: "absolute",
  },
  secondaryAlone: {
    ...SECONDARY_FAB_ALONE,
    position: "absolute",
  },
});
