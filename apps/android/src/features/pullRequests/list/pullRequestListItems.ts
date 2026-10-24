/**
 * Flattens a list page into virtualized items: one header per account
 * section, then its rows, or one problem row when the account is broken.
 */
import type { AccountState } from "../../../data/forgeContract";
import type { PullRequestListPage, PullRequestRow } from "../../../data/forgePullRequestContract";

/** One virtualized list item. */
export type PullRequestListItem =
  | {
      readonly attention: "new" | "seen";
      readonly count: number;
      readonly key: string;
      readonly kind: "attentionHeader";
    }
  | {
      readonly account: Exclude<AccountState, { readonly state: "connected" }>;
      readonly key: string;
      readonly kind: "problem";
    }
  | {
      readonly account: AccountState;
      readonly key: string;
      readonly kind: "row";
      readonly row: PullRequestRow;
    }
  | { readonly key: string; readonly kind: "empty" };

/** Builds the item sequence of one page. */
export function pullRequestListItems(page: PullRequestListPage): readonly PullRequestListItem[] {
  const items: PullRequestListItem[] = [];
  const rows: { readonly account: AccountState; readonly row: PullRequestRow }[] = [];
  for (const section of page.sections) {
    const { account } = section;
    if (account.state !== "connected") {
      items.push({ account, key: `problem:${account.account}`, kind: "problem" });
      continue;
    }
    for (const row of section.rows) {
      rows.push({ account, row });
    }
  }
  rows.sort((left, right) => right.row.updatedAt.localeCompare(left.row.updatedAt));
  appendAttentionGroup(items, rows, "new");
  appendAttentionGroup(items, rows, "seen");
  if (!items.some((item) => item.kind === "row" || item.kind === "problem")) {
    items.push({ key: "empty", kind: "empty" });
  }
  return items;
}

function appendAttentionGroup(
  items: PullRequestListItem[],
  rows: readonly { readonly account: AccountState; readonly row: PullRequestRow }[],
  attention: "new" | "seen",
): void {
  const group = rows.filter(({ row }) =>
    attention === "new" ? row.attention.state === "new" : row.attention.state !== "new",
  );
  if (group.length === 0) {
    return;
  }
  items.push({
    attention,
    count: group.length,
    key: `attention:${attention}`,
    kind: "attentionHeader",
  });
  for (const { account, row } of group) {
    items.push({ account, key: `row:${row.pullRequest}`, kind: "row", row });
  }
}
