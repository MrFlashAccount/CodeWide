import type { PullRequestListPage } from "../../../data/forgePullRequestContract";
import type { RemoteValue } from "../../../data/forgeRemoteValue";
import { ageAgo } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/**
 * One status line above the list: offline with the snapshot's age (Q3), or the
 * companion's reason when a refresh failed. Nothing while the data is current.
 */
export function ListNotice({
  nowMs,
  state,
}: {
  readonly nowMs: number;
  readonly state: RemoteValue<PullRequestListPage> | undefined;
}): React.JSX.Element | null {
  if (state?.status !== "failed") {
    return null;
  }
  const text =
    state.failure.kind === "unreachable" && state.value !== null
      ? `Offline · last updated ${ageAgo(state.value.fetchedAt, nowMs)}`
      : state.failure.message;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.notice} testID="pull-request-list-notice">
      {text}
    </Text>
  );
}
