import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, StyleSheet } from "react-native";
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { filterIconButtonPressed } from "../../presentation/input/filterIconButtonLayout";
import { searchFieldLayout } from "../../presentation/input/searchLayout";
import { colors, controlSize, iconSize, spacing, typeScale } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";
import { AppText as Text } from "../../ui/Typography";
import { useThreadListSearchPullModel } from "./threadListSearchPull";

const SEARCH_PULL_SCALE_DISTANCE = 120;
const SEARCH_PULL_SHADOW_DISTANCE = 60;
const SEARCH_PULL_MAX_SCALE = 1.05;
const SEARCH_PULL_MAX_ELEVATION = 5;

/** The fixed list header keeps search available while the catalog scrolls. */
export function ThreadListSearchRow({
  onOpenSearch,
}: {
  readonly onOpenSearch: () => void;
}): React.JSX.Element {
  const model = useThreadListSearchPullModel();
  const phase = useSelector(() => model?.phase$.get() ?? "idle");
  const pullStyle = useAnimatedStyle(() => {
    const pull = model?.distance.get() ?? 0;
    return {
      elevation: interpolate(
        pull,
        [0, SEARCH_PULL_SHADOW_DISTANCE],
        [0, SEARCH_PULL_MAX_ELEVATION],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          scale: interpolate(
            pull,
            [0, SEARCH_PULL_SCALE_DISTANCE],
            [1, SEARCH_PULL_MAX_SCALE],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  return (
    <Reanimated.View style={[styles.row, pullStyle]} testID="thread-search-row">
      <Pressable
        accessibilityHint={phase === "armed" ? "Opening search" : "Pull down to search"}
        accessibilityLabel="Search threads and messages"
        accessibilityRole="button"
        onPress={onOpenSearch}
        style={({ pressed }) => [styles.field, pressed && styles.pressed]}
      >
        <Ionicons color={colors.textMuted} name="search" size={iconSize.inline} />
        <Text style={styles.placeholder}>Search threads and messages</Text>
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  field: {
    ...searchFieldLayout,
    flex: 1,
    height: controlSize.regular,
  },
  placeholder: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  pressed: filterIconButtonPressed,
  row: {
    flexDirection: "row",
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: threadListLayout.edgeInset,
  },
});
