import { StyleSheet, View } from "react-native";

import type { EventCommits } from "../../../data/forgeConversationContract";
import { colors, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { moreCommitsLabel, shortSha } from "./eventCommits";

/** The event row's glyph circle, which the commit rows line up past. */
const GLYPH_CIRCLE_SIZE = 28;
const GLYPH_INSET = GLYPH_CIRCLE_SIZE + spacing.xs;

/** The commits of one push under its row: the short id in code type, then the title. */
export function EventCommitList({
  commits,
  testID,
}: {
  readonly commits: EventCommits;
  readonly testID: string;
}): React.JSX.Element {
  const more = moreCommitsLabel(commits);
  return (
    <View style={styles.list} testID={testID}>
      {commits.items.map((commit) => (
        <View
          accessibilityLabel={`Commit ${shortSha(commit)}, ${commit.title}`}
          accessible
          key={commit.sha}
          style={styles.row}
          testID={`${testID}-${commit.sha}`}
        >
          <Text style={styles.sha}>{shortSha(commit)}</Text>
          <Text numberOfLines={1} style={styles.title}>
            {commit.title}
          </Text>
        </View>
      ))}
      {more === null ? null : (
        <Text style={styles.more} testID={`${testID}-more`}>
          {more}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingBottom: spacing.sm,
    paddingLeft: spacing.md + GLYPH_INSET,
    paddingRight: spacing.md,
    rowGap: spacing.xxs,
  },
  more: {
    ...typeScale.label,
    color: colors.textDim,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  sha: {
    ...typeScale.code,
    color: colors.textDim,
    flexShrink: 0,
  },
  title: {
    ...typeScale.body,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
});
