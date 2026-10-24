import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { colors, controlSize, iconSize, spacing, typeScale, typeTracking } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";
import { AppText as Text } from "../../ui/Typography";
import { filterIconButtonPressed } from "./filterIconButtonLayout";
import { searchFieldLayout } from "./searchLayout";
import { CATALOG_SEARCH_PULL_THRESHOLD, useCatalogSearchPullModel } from "./catalogSearchPullModel";

const SEARCH_ROW_HEIGHT = controlSize.regular + spacing.xs;
const SEARCH_PULL_TRANSLATE_Y = SEARCH_ROW_HEIGHT * typeTracking.caps;
const SEARCH_PULL_MAX_SCALE =
  1 + spacing.optical / (CATALOG_SEARCH_PULL_THRESHOLD + iconSize.action);
const SEARCH_PULL_MAX_ELEVATION = spacing.inputInset / spacing.optical;

/** Shared catalog search trigger driven by the catalog's pull gesture. */
export function CatalogSearchRow({
  accessibilityLabel,
  actions,
  onOpenSearch,
  placeholder,
  testID,
}: {
  readonly accessibilityLabel: string;
  readonly actions?: ReactNode;
  readonly onOpenSearch: () => void;
  readonly placeholder: string;
  readonly testID: string;
}): React.JSX.Element {
  const model = useCatalogSearchPullModel();
  const phase = useSelector(() => model?.phase$.get() ?? "idle");
  const distance = model?.distance;
  const pullStyle = useAnimatedStyle(() => {
    const pull = distance?.get() ?? 0;
    return {
      elevation: interpolate(
        pull,
        [0, CATALOG_SEARCH_PULL_THRESHOLD],
        [0, SEARCH_PULL_MAX_ELEVATION],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          translateY: interpolate(
            pull,
            [0, CATALOG_SEARCH_PULL_THRESHOLD],
            [0, SEARCH_PULL_TRANSLATE_Y],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            pull,
            [0, CATALOG_SEARCH_PULL_THRESHOLD],
            [1, SEARCH_PULL_MAX_SCALE],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  return (
    <Reanimated.View style={[styles.row, pullStyle]} testID={testID}>
      <Pressable
        accessibilityHint={phase === "armed" ? "Release to search" : "Pull down to search"}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onOpenSearch}
        style={({ pressed }) => [styles.field, pressed && styles.pressed]}
      >
        <Ionicons color={colors.textMuted} name="search" size={iconSize.inline} />
        <Text style={styles.placeholder}>{placeholder}</Text>
      </Pressable>
      {actions}
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
