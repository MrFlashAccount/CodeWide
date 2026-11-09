import { StyleSheet } from "react-native";

import {
  FLOATING_ACTION_Z_INDEX,
  PRIMARY_FAB_PLACEMENT,
  SECONDARY_FAB_ABOVE_PRIMARY,
  SECONDARY_FAB_ALONE,
} from "./threadListFabGeometry";

export const styles = StyleSheet.create({
  primary: {
    ...PRIMARY_FAB_PLACEMENT,
    position: "absolute",
    zIndex: FLOATING_ACTION_Z_INDEX,
  },
  secondaryAbovePrimary: {
    ...SECONDARY_FAB_ABOVE_PRIMARY,
    position: "absolute",
    zIndex: FLOATING_ACTION_Z_INDEX,
  },
  secondaryAlone: {
    ...SECONDARY_FAB_ALONE,
    position: "absolute",
    zIndex: FLOATING_ACTION_Z_INDEX,
  },
});
