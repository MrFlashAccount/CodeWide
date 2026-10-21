import { View } from "react-native";

import type { PullRequestOverview, PullRequestRow } from "../../../data/forgePullRequestContract";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { ageAgo } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

const STATE_LABELS = { closed: "Closed", draft: "Draft", merged: "Merged", open: "Open" } as const;

/**
 * State badges, the branch pair (middle ellipsis keeps the last segment) and
 * change stats. The review request and age come from the PR's list row when one
 * is loaded; the overview read does not carry them.
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
    <View style={styles.column} testID="pull-request-status-header">
      <View style={styles.row}>
        <CaptionBadge label={STATE_LABELS[overview.state]} />
        {listRow?.reviewRequestedFromMe === true ? (
          <CaptionBadge label="Review requested · you" />
        ) : null}
        {overview.localCheckout === null ? null : <CaptionBadge label="Local checkout" />}
      </View>
      <Text
        accessibilityLabel={`Branch ${overview.headBranch} into ${overview.baseBranch}`}
        ellipsizeMode="middle"
        numberOfLines={1}
        style={styles.code}
      >
        {`${overview.headBranch} → ${overview.baseBranch}`}
      </Text>
      <View style={styles.row}>
        <Text style={styles.meta}>{`${String(overview.stats.files)} files · `}</Text>
        <Text style={[styles.meta, styles.success]}>{`+${String(overview.stats.additions)}`}</Text>
        <Text style={[styles.meta, styles.danger]}>{` −${String(overview.stats.deletions)}`}</Text>
        {age === "" ? null : <Text style={styles.meta}>{` · updated ${age}`}</Text>}
      </View>
    </View>
  );
}
