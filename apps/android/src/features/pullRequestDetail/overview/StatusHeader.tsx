import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";

import type { PullRequestOverview, PullRequestRow } from "../../../data/forgePullRequestContract";
import { ageAgo } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

/**
 * The PR title, state, author and source-to-target branches. The status line
 * also hosts the available verdict and the update age from a loaded list row.
 */
export function StatusHeader({
  children,
  listRow,
  nowMs,
  overview,
}: {
  readonly children: ReactNode;
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
      <View style={styles.statusLine}>
        <StatusByline age={age} author={overview.author} state={overview.state} />
        {children}
      </View>
      <Text
        accessibilityLabel={`From ${overview.headBranch} into ${overview.baseBranch}`}
        selectable
        style={styles.branches}
      >
        {overview.headBranch}
        <Text style={styles.arrow}>{" → "}</Text>
        <Text style={styles.target}>{overview.baseBranch}</Text>
      </Text>
    </View>
  );
}

function StatusByline({
  age,
  author,
  state,
}: {
  readonly age: string;
  readonly author: string;
  readonly state: PullRequestOverview["state"];
}): React.JSX.Element {
  return (
    <View style={styles.metadata}>
      <StatePill state={state} />
      <Text style={styles.byline}>
        <Text style={styles.author}>{author}</Text>
        {age === "" ? null : ` · updated ${age}`}
      </Text>
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
  arrow: {
    color: colors.textDim,
  },
  author: {
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  branches: {
    ...typeScale.code,
    color: colors.textMuted,
  },
  byline: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 1,
  },
  closedLabel: {
    color: colors.error,
  },
  closedSurface: {
    backgroundColor: colors.errorContainer,
  },
  header: {
    gap: spacing.xxs,
  },
  metadata: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: "100%",
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
  statusLine: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xxs,
  },
  target: {
    color: colors.text,
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
