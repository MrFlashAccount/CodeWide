import { ScrollView, StyleSheet, View } from "react-native";

import { colors, controlSize, layoutSize, radii, spacing } from "../../theme";

const TITLE_HEIGHT = 18;
const META_HEIGHT = 11;
const SUMMARY_CARD_HEIGHT = 88;
const DESCRIPTION_CARD_HEIGHT = 132;
const ACTIVITY_CARD_HEIGHT = 104;
const CARD_HEIGHTS = [SUMMARY_CARD_HEIGHT, DESCRIPTION_CARD_HEIGHT, ACTIVITY_CARD_HEIGHT] as const;

/**
 * Stable detail-pane placeholder shown from the first navigation frame. Like the screen it stands
 * in for, it paints no surface: it sits on the surface of the pane it is placed in.
 */
export function PullRequestScreenSkeleton(): React.JSX.Element {
  return (
    <View
      accessibilityLabel="Pull request is loading"
      accessibilityState={{ busy: true }}
      style={styles.screen}
      testID="pull-request-loading"
    >
      <SkeletonAppBar />
      <SkeletonTabs />
      <SkeletonCards />
    </View>
  );
}

function SkeletonAppBar(): React.JSX.Element {
  return (
    <View style={styles.appBar}>
      <View style={styles.back} />
      <View style={styles.heading}>
        <View style={styles.title} />
        <View style={styles.meta} />
      </View>
    </View>
  );
}

function SkeletonTabs(): React.JSX.Element {
  return (
    <View style={styles.tabs}>
      <View style={styles.tab} />
      <View style={styles.tab} />
    </View>
  );
}

function SkeletonCards(): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {CARD_HEIGHTS.map((height) => (
        <View key={height} style={[styles.card, { height }]} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  appBar: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.md,
  },
  back: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    height: controlSize.compact,
    width: controlSize.compact,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
  },
  content: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  heading: {
    flex: 1,
    gap: spacing.xs,
  },
  meta: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.compact,
    height: META_HEIGHT,
    width: "42%",
  },
  screen: {
    flex: 1,
  },
  tab: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.compact,
    height: META_HEIGHT,
    width: "22%",
  },
  tabs: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.lg,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  title: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.compact,
    height: TITLE_HEIGHT,
    width: "68%",
  },
});
