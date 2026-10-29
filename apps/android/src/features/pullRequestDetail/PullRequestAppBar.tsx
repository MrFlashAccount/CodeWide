import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ProviderIcon } from "../../data/forgeProviderIcon";
import type { PullRequestOverview } from "../../data/forgePullRequestContract";
import { colors, controlSize, iconSize, spacing, typeScale, typeWeight } from "../../theme";
import { ForgeIcon } from "../../ui/ForgeIcon";
import { AppText as Text } from "../../ui/Typography";
import { OverflowActionsMenu, type ExtraMenuItem } from "./actions/OverflowActionsMenu";
import { repositoryShortName } from "./pullRequestPresentation";

/**
 * `‹  [icon] repo #91  ⋯` on Details, whose header carries the full title, and
 * `‹  #91 · Files changed  [Review]  ⋯` on the Changes route pushed over it. One
 * compact row; the one ⋯ holds every overflowed catalog action and Open on forge.
 */
export function PullRequestAppBar({
  extra,
  fullscreen,
  icon,
  onBack,
  onFullscreen,
  onRun,
  overflow,
  overview,
  section,
  trailing,
}: {
  readonly extra: readonly ExtraMenuItem[];
  readonly fullscreen: boolean;
  readonly icon: ProviderIcon | null;
  readonly onBack: (() => void) | null;
  readonly onFullscreen: (() => void) | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly overflow: readonly ActionDescriptor[];
  readonly overview: PullRequestOverview;
  /** The nested route's name (`Files changed`); `null` on Details. */
  readonly section: string | null;
  /** Route controls before ⤢ and ⋯, such as Submit review. */
  readonly trailing: React.ReactNode;
}): React.JSX.Element {
  return (
    <View
      style={[styles.bar, onBack === null && styles.barWithoutBack]}
      testID="pull-request-app-bar"
    >
      {onBack === null ? null : (
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.icon}
        >
          <Ionicons color={colors.text} name="chevron-back" size={iconSize.navigation} />
        </Pressable>
      )}
      <AppBarTitles icon={icon} overview={overview} section={section} />
      {trailing}
      {onFullscreen === null ? null : (
        <Pressable
          accessibilityLabel={
            fullscreen ? "Exit pull request fullscreen" : "Open pull request fullscreen"
          }
          accessibilityRole="button"
          onPress={onFullscreen}
          style={styles.icon}
        >
          <Ionicons
            color={colors.text}
            name={fullscreen ? "contract-outline" : "expand-outline"}
            size={iconSize.action}
          />
        </Pressable>
      )}
      <OverflowActionsMenu
        accessibilityLabel="Pull request menu"
        actions={overflow}
        extra={extra}
        onRun={onRun}
      />
    </View>
  );
}

function AppBarTitles({
  icon,
  overview,
  section,
}: {
  readonly icon: ProviderIcon | null;
  readonly overview: PullRequestOverview;
  readonly section: string | null;
}): React.JSX.Element {
  return (
    <View style={styles.titles}>
      <View style={styles.titleRow}>
        {section === null ? <ForgeIcon color={colors.text} icon={icon} /> : null}
        <TitleText overview={overview} section={section} />
      </View>
    </View>
  );
}

function TitleText({
  overview,
  section,
}: {
  readonly overview: PullRequestOverview;
  readonly section: string | null;
}): React.JSX.Element {
  return (
    <Text accessibilityRole="header" ellipsizeMode="tail" numberOfLines={1} style={styles.title}>
      {section === null
        ? `${repositoryShortName(overview.repository)} #${overview.number}`
        : `#${overview.number}`}
      {section === null ? null : <Text style={styles.section}>{` · ${section}`}</Text>}
    </Text>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.xxs,
  },
  // Without a back button the title aligns with the page content inset.
  barWithoutBack: {
    paddingLeft: spacing.md,
  },
  icon: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.regular,
  },
  section: {
    color: colors.textMuted,
    fontWeight: typeWeight.regular,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
  },
  titleRow: {
    alignItems: "center",
    columnGap: spacing.compact,
    flexDirection: "row",
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
});
