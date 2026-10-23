import { useSyncExternalStore } from "react";

import type { PullRequestKey } from "./forgeContract";
import type { ForgeQueryResource } from "./forgeQueryResource";
import type {
  PullRequestCategory,
  PullRequestListPage,
  PullRequestListSection,
  PullRequestRow,
} from "./forgePullRequestContract";
import { useEvent } from "../react/useEvent";

/** Identity of one list: connection, category and optional repository filter. */
export type ListParams = {
  readonly category: PullRequestCategory;
  readonly connectionId: string;
  readonly repository: string | null;
};

/**
 * Appends the next cross-account page. Sections merge by account key; the
 * newest account state wins because it reflects the latest plugin answer.
 */
export function mergeListPages(
  current: PullRequestListPage,
  next: PullRequestListPage,
): PullRequestListPage {
  const sections = new Map<string, PullRequestListSection>();
  for (const section of current.sections) {
    sections.set(section.account.account, section);
  }
  for (const section of next.sections) {
    const previous = sections.get(section.account.account);
    sections.set(
      section.account.account,
      previous === undefined ? section : { ...section, rows: [...previous.rows, ...section.rows] },
    );
  }
  return {
    ...next,
    repositories: [...new Set([...current.repositories, ...next.repositories])],
    sections: [...sections.values()],
  };
}

/**
 * The PR's row in any list already loaded for the connection, for the facts the
 * overview read does not carry (review request, last update). `null` on a cold
 * deep link.
 */
function loadedListRow(
  lists: ForgeQueryResource<ListParams, PullRequestListPage>,
  connectionId: string,
  pullRequest: PullRequestKey,
): PullRequestRow | null {
  const cached = lists.client.getQueriesData<PullRequestListPage>({
    queryKey: ["forge", "lists", connectionId],
  });
  for (const [, page] of cached) {
    for (const section of page?.sections ?? []) {
      const row = section.rows.find((candidate) => candidate.pullRequest === pullRequest);
      if (row !== undefined) {
        return row;
      }
    }
  }
  return null;
}

/** Subscribes to the cached list row used by the detail header. */
export function useLoadedListRow(
  lists: ForgeQueryResource<ListParams, PullRequestListPage>,
  connectionId: string,
  pullRequest: PullRequestKey,
): PullRequestRow | null {
  const subscribe = useEvent((onStoreChange: () => void) =>
    lists.client.getQueryCache().subscribe(() => {
      onStoreChange();
    }),
  );
  const snapshot = useEvent(() => loadedListRow(lists, connectionId, pullRequest));
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
