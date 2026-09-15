import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { SidebarListFeedback } from "./SidebarListFeedback";
import { styles } from "./ThreadListBoundary.styles";

export function ThreadListSuspenseFallback() {
  return <SidebarListFeedback state={{ status: "loading" }} archived={false} />;
}

export function ThreadListExperimentSuspended() {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons name="pause-circle-outline" size={iconSize.navigation} color={colors.amber} />
      <Text style={styles.threadListEmptyText}>Thread list paused by performance experiment</Text>
    </View>
  );
}
