import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useAsyncResource } from "../../rendering/async-resource-store";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import type { SidebarProject } from "../projects/sidebarProjects";
import { storedThreadToListItem } from "../threadList/threadListProjection";
import type { ThreadListItem } from "../threadList/threadListTypes";
import { abortableDelay } from "./searchDelay";

type ThreadSearch = (query: string, connectionId?: string | null) => Promise<StoredThreadSummary[]>;
/** Debounced catalog search retains the existing model-owned resource key. */
export function useThreadSearch(
  native: boolean,
  searchThreads: ThreadSearch,
  activeServerId: string,
  sidebarProject: SidebarProject | null,
  mobileThreadQuery: string,
  serverThreads: ThreadListItem[],
  archivedThreads: ThreadListItem[],
) {
  const normalizedMobileThreadQuery = mobileThreadQuery.trim().toLocaleLowerCase();

  const mobileSearchKey = `${activeServerId}\u0000${normalizedMobileThreadQuery}`;

  const mobileRemoteSearchResource = useAsyncResource<ThreadListItem[]>(
    native && sidebarProject === null ? "mobile-thread-search" : null,
    mobileSearchKey,
    async (_publish, signal) => {
      if (normalizedMobileThreadQuery === "") return [];
      await abortableDelay(60, signal);
      const results = await searchThreads(
        mobileThreadQuery,
        activeServerId === ALL_SERVERS_ID ? null : activeServerId,
      );
      return results.map(storedThreadToListItem);
    },
  );

  const mobileNativeSearch =
    normalizedMobileThreadQuery === "" ? null : (mobileRemoteSearchResource.value ?? []);

  const mobileVisibleThreads =
    mobileNativeSearch === null
      ? serverThreads
      : mobileNativeSearch.filter((thread) => !thread.archived);

  const mobileVisibleArchivedThreads =
    mobileNativeSearch === null
      ? archivedThreads
      : mobileNativeSearch.filter((thread) => thread.archived);
  return {
    normalizedMobileThreadQuery,
    mobileRemoteSearchResource,
    mobileVisibleThreads,
    mobileVisibleArchivedThreads,
  };
}
