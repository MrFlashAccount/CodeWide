import type { AccountState } from "../../../data/forgeContract";
import type { ProviderIcon } from "../../../data/forgeProviderIcon";
import type { PullRequestRow as Row } from "../../../data/forgePullRequestContract";
import { AccountProblemRow } from "./AccountProblemRow";
import { AttentionSectionHeader } from "./AttentionSectionHeader";
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
  return (
    <PullRequestRow
      icon={iconFor(item.account.pluginId)}
      nowMs={nowMs}
      onPress={onOpen}
      row={item.row}
    />
  );
}
