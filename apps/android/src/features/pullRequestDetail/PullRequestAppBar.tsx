import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { PullRequestOverview } from "../../data/forgePullRequestContract";
import { colors, controlSize, iconSize, layoutSize, spacing, typeScale } from "../../theme";
import { ForgeIcon } from "../../ui/ForgeIcon";
import { AppText as Text } from "../../ui/Typography";
import { OverflowActionsMenu, type ExtraMenuItem } from "./actions/OverflowActionsMenu";
import { repositoryShortName } from "./pullRequestPresentation";

/** `‹  [icon] #91 Title  ⋯` with `repo · author → base` below; ⋯ holds overflow actions. */
export function PullRequestAppBar({
  extra,
  fullscreen,
  icon,
  onBack,
  onFullscreen,
  onRun,
  overflow,
  overview,
}: {
  readonly extra: readonly ExtraMenuItem[];
  readonly fullscreen: boolean;
  readonly icon: {
    readonly glyph: { readonly path: string } | null;
    readonly iconKey: string;
  } | null;
  readonly onBack: (() => void) | null;
  readonly onFullscreen: (() => void) | null;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly overflow: readonly ActionDescriptor[];
  readonly overview: PullRequestOverview;
}): React.JSX.Element {
  return (
    <View style={styles.bar} testID="pull-request-app-bar">
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
      <AppBarTitles icon={icon} overview={overview} />
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
}: {
  readonly icon: {
    readonly glyph: { readonly path: string } | null;
    readonly iconKey: string;
  } | null;
  readonly overview: PullRequestOverview;
}): React.JSX.Element {
  return (
    <View style={styles.titles}>
      <View style={styles.titleRow}>
        <ForgeIcon color={colors.text} glyph={icon?.glyph ?? null} iconKey={icon?.iconKey ?? ""} />
        <Text
          accessibilityRole="header"
          ellipsizeMode="tail"
          numberOfLines={1}
          style={styles.title}
        >
          {`#${overview.number} ${overview.title}`}
        </Text>
      </View>
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.subtitle}>
        {`${repositoryShortName(overview.repository)} · ${overview.author} → ${overview.baseBranch}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: layoutSize.header,
    paddingHorizontal: spacing.xxs,
  },
  icon: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  subtitle: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
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
