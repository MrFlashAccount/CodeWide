import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { SidebarListFeedback } from "./SidebarListFeedback";
import { styles } from "./ThreadListBoundary.styles";

export function ThreadListSuspenseFallback() {
  return <SidebarListFeedback archived={false} state={{ status: "loading" }} />;
}

export function ThreadListExperimentSuspended() {
  return (
    <View style={styles.threadListEmpty}>
      <Ionicons color={colors.amber} name="pause-circle-outline" size={iconSize.navigation} />
      <Text style={styles.threadListEmptyText}>Thread list paused by performance experiment</Text>
    </View>
  );
}
