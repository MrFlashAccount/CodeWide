import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import type { ChangesView } from "../pullRequestScreenModel";

/**
 * Details' entries into the nested review routes, GitHub-mobile style: Files
 * changed (with the PR's size and pending drafts) and the review guide.
 */
export function ReviewLinks({
  draftCount,
  onOpen,
  stats,
}: {
  readonly draftCount: number;
  readonly onOpen: (view: ChangesView) => void;
  readonly stats: PullRequestOverview["stats"];
}): React.JSX.Element {
  return (
    <View style={styles.group}>
      <LinkRow
        icon="documents-outline"
        label="Files changed"
        onPress={() => {
          onOpen("files");
        }}
        testID="pull-request-open-changes"
      >
        <Text
          style={styles.meta}
        >{`${String(stats.files)} ${stats.files === 1 ? "file" : "files"} · `}</Text>
        <Text style={styles.added}>{`+${String(stats.additions)} `}</Text>
        <Text style={styles.removed}>{`−${String(stats.deletions)}`}</Text>
        {draftCount === 0 ? null : (
          <Text style={styles.drafts}>
            {` · ${String(draftCount)} ${draftCount === 1 ? "draft" : "drafts"}`}
          </Text>
        )}
      </LinkRow>
      <View style={styles.separator} />
      <LinkRow
        icon="sparkles-outline"
        label="Review guide"
        onPress={() => {
          onOpen("guide");
        }}
        testID="pull-request-open-guide"
      />
    </View>
  );
}

function LinkRow({
  children = null,
  icon,
  label,
  onPress,
  testID,
}: {
  readonly children?: React.ReactNode;
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      <Text numberOfLines={1} style={styles.trailing}>
        {children}
      </Text>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={iconSize.inline} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  added: {
    color: colors.success,
  },
  drafts: {
    color: colors.primary,
  },
  group: {
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  meta: {
    color: colors.textMuted,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  removed: {
    color: colors.error,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  separator: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.sm + iconSize.action + spacing.sm,
  },
  trailing: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
});
