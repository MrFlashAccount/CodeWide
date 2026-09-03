import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";

interface TimelineNavigationViewProps {
  onJumpToLatest(): Promise<void>;
  unseenCount: number;
  visible: boolean;
}

export function TimelineNavigationView(
  props: TimelineNavigationViewProps,
): React.JSX.Element | null {
  const { onJumpToLatest, unseenCount, visible } = props;
  const jumpToLatest = useEvent(() => {
    onJumpToLatest().catch(() => undefined);
  });
  if (!visible) return null;
  return (
    <Pressable
      accessibilityLabel={
        unseenCount > 0 ? `Jump to latest, ${unseenCount} new turns` : "Jump to latest"
      }
      accessibilityRole="button"
      onPress={jumpToLatest}
      style={styles.jumpToLatest}
      testID="jump-to-latest"
    >
      <PresentationIcon color={colors.onPrimaryContainer} name="chevronDown" size={22} />
      {unseenCount > 0 ? (
        <View style={styles.unreadBadge}>
          <ProductText accessibilityLiveRegion="polite" style={styles.unreadBadgeText}>
            {unseenCount > 99 ? "99+" : unseenCount}
          </ProductText>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  jumpToLatest: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.pill,
    bottom: spacing.xs,
    elevation: 4,
    height: 42,
    justifyContent: "center",
    position: "absolute",
    width: 42,
  },
  unreadBadge: {
    alignItems: "center",
    backgroundColor: colors.red,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: 18,
    minWidth: 18,
    paddingHorizontal: spacing.xxs,
    position: "absolute",
    right: -spacing.xxs,
    top: -spacing.xxs,
  },
  unreadBadgeText: { ...typeScale.caption, color: colors.text },
});
