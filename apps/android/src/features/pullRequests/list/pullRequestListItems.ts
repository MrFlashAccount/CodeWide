/**
 * Flattens a list page into virtualized items: one header per account
 * section, then its rows, or one problem row when the account is broken.
 */
import type { AccountState } from "../../../data/forgeContract";
import type { PullRequestListPage, PullRequestRow } from "../../../data/forgePullRequestContract";

/** One virtualized list item. */
export type PullRequestListItem =
  | {
      readonly account: AccountState;
      readonly key: string;
      readonly kind: "header";
      readonly openCount: number | null;
    }
  | {
      readonly account: Exclude<AccountState, { readonly state: "connected" }>;
      readonly key: string;
      readonly kind: "problem";
    }
  | { readonly key: string; readonly kind: "row"; readonly row: PullRequestRow }
  | { readonly key: string; readonly kind: "empty" };

/** Builds the item sequence of one page. */
export function pullRequestListItems(page: PullRequestListPage): readonly PullRequestListItem[] {
  const items: PullRequestListItem[] = [];
  for (const section of page.sections) {
    const { account } = section;
    const connected = account.state === "connected";
    items.push({
      account,
      key: `header:${account.account}`,
      kind: "header",
      openCount: connected ? section.rows.length : null,
    });
    if (account.state !== "connected") {
      items.push({ account, key: `problem:${account.account}`, kind: "problem" });
      continue;
    }
    for (const row of section.rows) {
      items.push({ key: `row:${row.pullRequest}`, kind: "row", row });
    }
  }
  if (!items.some((item) => item.kind === "row" || item.kind === "problem")) {
    items.push({ key: "empty", kind: "empty" });
  }
  return items;
}

/** Categories at least one section supports. */
export function supportedCategories(
  page: PullRequestListPage | null,
): ReadonlySet<PullRequestListPage["category"]> {
  const categories = new Set<PullRequestListPage["category"]>();
  for (const section of page?.sections ?? []) {
    for (const category of section.supportedCategories) {
      categories.add(category);
    }
  }
  if (categories.size === 0) {
    categories.add("reviewRequested");
    categories.add("authored");
  }
  return categories;
}
