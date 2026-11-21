import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ProviderIcon } from "../../data/forgeProviderIcon";
import type { PullRequestOverview } from "../../data/forgePullRequestContract";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../theme";
import { ForgeIcon } from "../../ui/ForgeIcon";
import { ThreePanelsHeader, type ThreePanelsBack } from "../../ui/ThreePanelsHeader";
import { AppText as Text } from "../../ui/Typography";
import { OverflowActionsMenu, type ExtraMenuItem } from "./actions/OverflowActionsMenu";
import { repositoryShortName } from "./pullRequestPresentation";

/** The PR overview owns the actions menu. Nested routes show the PR number and section as a heading. */
export function PullRequestAppBar({
  back,
  extra,
  icon,
  onRun,
  overflow,
  overview,
  section,
  trailing,
}: {
  readonly back: ThreePanelsBack | null;
  readonly extra: readonly ExtraMenuItem[];
  readonly icon: ProviderIcon | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly overflow: readonly ActionDescriptor[];
  readonly overview: PullRequestOverview;
  /** The nested route's name (`Files changed`); `null` on Details. */
  readonly section: string | null;
  readonly trailing?: React.ReactNode;
}): React.JSX.Element {
  return (
    <ThreePanelsHeader
      back={back}
      menu={
        section === null ? (
          <OverflowActionsMenu
            accessibilityLabel="Pull request menu"
            actions={overflow}
            extra={extra}
            onRun={onRun}
          />
        ) : null
      }
      style={styles.bar}
      testID="pull-request-app-bar"
      title={<AppBarTitles icon={icon} overview={overview} section={section} />}
      trailing={trailing}
      withoutBackStyle={styles.barWithoutBack}
    />
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
    <View style={styles.titleRow}>
      {section === null ? <ForgeIcon color={colors.text} icon={icon} /> : null}
      <TitleText overview={overview} section={section} />
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
  // Fills the title slot so a long repository name truncates instead of overflowing the controls.
  titleRow: {
    alignItems: "center",
    columnGap: spacing.compact,
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
});
