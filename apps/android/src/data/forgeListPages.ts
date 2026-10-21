import type { PullRequestKey } from "./forgeContract";
import type { KeyedResource } from "./forgeKeyedResource";
import type {
  PullRequestCategory,
  PullRequestListPage,
  PullRequestListSection,
  PullRequestRow,
} from "./forgePullRequestContract";
import { remoteValue } from "./forgeRemoteValue";

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
 * overview read does not carry (review request, last update). Reads observables,
 * so a selector over it follows list refreshes; `null` on a cold deep link.
 */
export function loadedListRow(
  lists: KeyedResource<ListParams, PullRequestListPage>,
  connectionId: string,
  pullRequest: PullRequestKey,
): PullRequestRow | null {
  for (const params of lists.loaded()) {
    if (params.connectionId !== connectionId) {
      continue;
    }
    const page = remoteValue(lists.state$[lists.keyOf(params)]?.get());
    for (const section of page?.sections ?? []) {
      const row = section.rows.find((candidate) => candidate.pullRequest === pullRequest);
      if (row !== undefined) {
        return row;
      }
    }
  }
  return null;
}
