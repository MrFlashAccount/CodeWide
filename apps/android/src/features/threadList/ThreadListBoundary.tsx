import { Ionicons } from "@expo/vector-icons";
import type { ReactElement } from "react";
import { View } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ThreadListBoundary.styles";

/** Whole-screen suspension must never use the delayed empty-row feedback. */
export function ThreadListSuspenseFallback() {
  return <ThreadListSkeleton />;
}

const SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const;

/** Row-shaped placeholder while no authoritative catalog snapshot is available. */
export function ThreadListSkeleton(): ReactElement {
  return (
    <View
      accessibilityLabel="Loading threads"
      accessibilityState={{ busy: true }}
      style={styles.threadListSkeleton}
      testID="thread-list-skeleton"
    >
      {SKELETON_ROWS.map((row) => (
        <View key={row} style={styles.threadListSkeletonRow}>
          <View style={styles.threadListSkeletonTitle} />
          <View style={styles.threadListSkeletonPreview} />
        </View>
      ))}
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
