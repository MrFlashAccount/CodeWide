import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";

import type { PullRequestOverview, PullRequestRow } from "../../../data/forgePullRequestContract";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { ageAgo } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/**
 * The PR's identity as the forge presents it: the full title, a filled state
 * pill, who merges which branch into which, and the change stats. The age comes
 * from the PR's list row when one is loaded; the overview read does not carry it.
 */
export function StatusHeader({
  listRow,
  nowMs,
  overview,
}: {
  readonly listRow: PullRequestRow | null;
  readonly nowMs: number;
  readonly overview: PullRequestOverview;
}): React.JSX.Element {
  const age = listRow === null ? "" : ageAgo(listRow.updatedAt, nowMs);
  return (
    <View style={styles.header} testID="pull-request-status-header">
      <Text accessibilityRole="header" selectable style={styles.title}>
        {overview.title}
      </Text>
      <StatePill state={overview.state} />
      <Text style={styles.byline}>
        <Text style={styles.author}>{overview.author}</Text>
        {" wants to merge into "}
        <Text style={styles.branch}>{overview.baseBranch}</Text>
        {" from "}
        <Text style={styles.branch}>{overview.headBranch}</Text>
      </Text>
      <View style={styles.stats}>
        <Text style={styles.meta}>{`${String(overview.stats.files)} files`}</Text>
        <Text
          style={[styles.meta, styles.additions]}
        >{`+${String(overview.stats.additions)}`}</Text>
        <Text
          style={[styles.meta, styles.deletions]}
        >{`−${String(overview.stats.deletions)}`}</Text>
        {age === "" ? null : <Text style={styles.meta}>{`· updated ${age}`}</Text>}
        {overview.localCheckout === null ? null : <CaptionBadge label="Local checkout" />}
      </View>
    </View>
  );
}

function StatePill({ state }: { readonly state: PullRequestOverview["state"] }) {
  const pill = STATE_PILLS[state];
  return (
    <View style={[styles.pill, pill.surface]}>
      <Ionicons color={pill.color} name={pill.icon} size={iconSize.inline} />
      <Text style={[styles.pillLabel, pill.label]}>{pill.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  additions: {
    color: colors.success,
  },
  author: {
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  branch: {
    ...typeScale.code,
    backgroundColor: colors.surfaceContainerHigh,
    color: colors.text,
  },
  byline: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  closedLabel: {
    color: colors.error,
  },
  closedSurface: {
    backgroundColor: colors.errorContainer,
  },
  deletions: {
    color: colors.error,
  },
  header: {
    alignItems: "flex-start",
    gap: spacing.xs,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  neutralLabel: {
    color: colors.textMuted,
  },
  neutralSurface: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  openLabel: {
    color: colors.success,
  },
  openSurface: {
    backgroundColor: colors.successContainer,
  },
  pill: {
    alignItems: "center",
    borderRadius: radii.pill,
    columnGap: spacing.xxs,
    flexDirection: "row",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  pillLabel: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  stats: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xxs,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
});

const STATE_PILLS: Readonly<
  Record<
    PullRequestOverview["state"],
    {
      readonly color: string;
      readonly icon: "git-merge-outline" | "git-pull-request-outline";
      readonly label: TextStyle;
      readonly surface: ViewStyle;
      readonly text: string;
    }
  >
> = {
  closed: {
    color: colors.error,
    icon: "git-pull-request-outline",
    label: styles.closedLabel,
    surface: styles.closedSurface,
    text: "Closed",
  },
  draft: {
    color: colors.textMuted,
    icon: "git-pull-request-outline",
    label: styles.neutralLabel,
    surface: styles.neutralSurface,
    text: "Draft",
  },
  merged: {
    color: colors.textMuted,
    icon: "git-merge-outline",
    label: styles.neutralLabel,
    surface: styles.neutralSurface,
    text: "Merged",
  },
  open: {
    color: colors.success,
    icon: "git-pull-request-outline",
    label: styles.openLabel,
    surface: styles.openSurface,
    text: "Open",
  },
};
