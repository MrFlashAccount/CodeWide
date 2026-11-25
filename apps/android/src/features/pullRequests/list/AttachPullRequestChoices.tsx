import { useState } from "react";
import { StyleSheet } from "react-native";

import type { PullRequestKey } from "../../../data/forgeContract";
import { classifyForgeError } from "../../../data/forgeErrors";
import type {
  PullRequestBadge,
  PullRequestListPage,
  PullRequestRow,
} from "../../../data/forgePullRequestContract";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { AppButton } from "../../../presentation/controls/AppButton";
import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../../theme";
import { AppList } from "../../../ui/AppList";
import { AppListItem } from "../../../ui/AppListItem";
import { listRowHeight } from "../../../ui/AppListRow.types";
import { AppSheetScrollView } from "../../../ui/AppSheet";
import { AppText } from "../../../ui/Typography";
import { useAppNotice } from "../../../ui/useAppNotice";
import { isCatalogAccount } from "./catalogAccounts";
import { ListSkeleton } from "./ListSkeleton";
import { PullRequestEmptyState } from "./PullRequestEmptyState";

function choiceHeight(): number {
  return listRowHeight.double;
}

/** Connected account rows share the Companion's canonical PR key across accounts and pages. */
export function AttachPullRequestChoices({
  badges,
  failed,
  filter,
  loadMore,
  onSelect,
  page,
  pending,
}: {
  readonly badges: readonly PullRequestBadge[];
  readonly failed: boolean;
  readonly filter: PullRequestSearchFilter;
  readonly loadMore: () => Promise<void>;
  readonly onSelect: (row: PullRequestRow) => void;
  readonly page: PullRequestListPage | null;
  readonly pending: string | null;
}): React.JSX.Element | null {
  const notice = useAppNotice();
  const [loadingMore, setLoadingMore] = useState(false);
  const more = useEvent(() => {
    if (loadingMore) {
      return;
    }
    setLoadingMore(true);
    loadMore()
      .catch((error: unknown) => {
        notice.show({
          description: classifyForgeError(error).message,
          label: "Could not load more pull requests",
          variant: "error",
        });
      })
      .finally(() => {
        setLoadingMore(false);
      });
  });
  if (page === null) {
    return failed ? null : <ListSkeleton />;
  }
  const { connected, problems, rows } = pickerChoices(page);
  const attached = new Set(badges.map((badge) => badge.pullRequest));
  const empty = connected ? (
    <PullRequestEmptyState filter={filter} />
  ) : problems.length === 0 ? (
    <AppText style={styles.note}>
      Connect a pull request account in Settings to attach a pull request.
    </AppText>
  ) : null;
  return (
    <AppList
      contentContainerStyle={styles.content}
      data={rows}
      empty={empty}
      extraData={{ attached, pending }}
      footer={
        page.nextCursor === null ? null : (
          <AppButton isDisabled={loadingMore} onPress={more} variant="outline">
            Load more
          </AppButton>
        )
      }
      getFixedItemSize={choiceHeight}
      header={
        problems.length > 0 ? <AppText style={styles.note}>{problems.join("\n")}</AppText> : null
      }
      keyboardShouldPersistTaps="handled"
      keyExtractor={(item) => item.pullRequest}
      recycleItems
      renderItem={({ item }) => (
        <AppListItem
          accessibilityLabel={`${item.title}, ${item.repository} #${item.number}${attached.has(item.pullRequest) ? ", attached" : ""}`}
          description={`${item.repository} #${item.number} · ${item.author}`}
          disabled={pending !== null || attached.has(item.pullRequest)}
          fixedHeight={listRowHeight.double}
          leadingIcon={{ name: "git-branch-outline" }}
          onPress={() => {
            onSelect(item);
          }}
          shimmering={pending === item.pullRequest}
          title={item.title}
          {...(attached.has(item.pullRequest)
            ? { trailingIcon: { name: "checkmark" as const } }
            : {})}
        />
      )}
      scrollComponent={AppSheetScrollView}
      virtualized
    />
  );
}

function updatedTime(row: PullRequestRow): number {
  const time = Date.parse(row.updatedAt);
  return Number.isNaN(time) ? 0 : time;
}

function mergeAccountRows(
  rows: Map<PullRequestKey, PullRequestRow>,
  entries: readonly PullRequestRow[],
) {
  for (const row of entries) {
    const previous = rows.get(row.pullRequest);
    if (previous === undefined || updatedTime(row) >= updatedTime(previous)) {
      rows.set(row.pullRequest, row);
    }
  }
}

function pickerChoices(page: PullRequestListPage) {
  const rows = new Map<PullRequestKey, PullRequestRow>();
  const problems: string[] = [];
  let connected = false;
  for (const { account, rows: entries } of page.sections) {
    if (isCatalogAccount(account)) {
      connected = true;
      mergeAccountRows(rows, entries);
    } else if (account.catalogEnabled !== false && account.state !== "connected") {
      problems.push(
        `${account.login} · ${account.state === "expired" ? account.hint : account.reason}`,
      );
    }
  }
  return {
    connected,
    problems,
    rows: Array.from(rows.values()).sort((left, right) => updatedTime(right) - updatedTime(left)),
  };
}

const styles = StyleSheet.create({
  content: { padding: spacing.md },
  note: {
    ...typeScale.body,
    color: colors.textMuted,
    paddingVertical: spacing.sm,
  },
});
