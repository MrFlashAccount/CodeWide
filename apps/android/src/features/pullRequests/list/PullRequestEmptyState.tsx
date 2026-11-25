import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { colors, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";
import { pullRequestEmptyStateCopy } from "./pullRequestEmptyState";

/** A quiet zero-inbox state that distinguishes an empty view from a failed search. */
export function PullRequestEmptyState({
  filter,
}: {
  readonly filter: PullRequestSearchFilter;
}): React.JSX.Element {
  const copy = pullRequestEmptyStateCopy(filter);
  return (
    <View style={styles.emptyState} testID="pull-request-empty-state">
      <View style={styles.emptyMark}>
        <Ionicons color={colors.textMuted} name={copy.icon} size={iconSize.navigation} />
      </View>
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {copy.title}
      </Text>
      <Text style={styles.emptyDescription}>{copy.description}</Text>
    </View>
  );
}
