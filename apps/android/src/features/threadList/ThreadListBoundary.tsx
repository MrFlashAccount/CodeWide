import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadListBoundary.styles";

/** Whole-screen suspension must never use the delayed empty-row feedback. */
export function ThreadListSuspenseFallback() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.threadListEmpty}>
      <ActivityIndicator accessibilityLabel="Loading threads" color={colors.accent} />
      <Text style={styles.threadListEmptyText}>Loading threads…</Text>
    </View>
  );
}

export function ThreadListExperimentSuspended() {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons color={colors.amber} name="pause-circle-outline" size={iconSize.navigation} />
      <Text style={styles.threadListEmptyText}>Thread list paused by performance experiment</Text>
    </View>
  );
}
