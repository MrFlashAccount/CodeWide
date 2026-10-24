import type { AccountState, ProviderIcon } from "../../../data/forgeContract";
import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import { AppText as Text } from "../../../ui/Typography";
import { AccountProblemRow } from "./AccountProblemRow";
import { AttentionSectionHeader } from "./AttentionSectionHeader";
import { listStyles as styles } from "./list.styles";
import type { PullRequestListItem } from "./pullRequestListItems";
import { PullRequestRow } from "./PullRequestRow";

/** Renders one virtualized list item by its kind. */
export function PullRequestListItemView({
  iconFor,
  item,
  nowMs,
  onOpen,
  onReconnect,
  onRetry,
}: {
  readonly iconFor: (pluginId: string) => ProviderIcon | null;
  readonly item: PullRequestListItem;
  readonly nowMs: number;
  readonly onOpen: (row: Row) => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (item.kind === "attentionHeader") {
    return <AttentionSectionHeader count={item.count} state={item.attention} />;
  }
  if (item.kind === "problem") {
    return <AccountProblemRow account={item.account} onReconnect={onReconnect} onRetry={onRetry} />;
  }
  if (item.kind === "row") {
    return (
      <PullRequestRow
        icon={iconFor(item.account.pluginId)}
        nowMs={nowMs}
        onPress={onOpen}
        row={item.row}
      />
    );
  }
  return <Text style={styles.notice}>No pull requests in this category.</Text>;
}
