import { router } from "expo-router";
import { useState, useSyncExternalStore } from "react";

import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { ServerSelectorView } from "../../presentation/navigation/ServerSelectorView";
import { ThreadSidebarView } from "../../presentation/navigation/ThreadSidebarView";
import { useEvent } from "../../../react/useEvent";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import { threadId, type SavedServerId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { useV2Runtime } from "../../V2Application";
import {
  newSavedServerDestination,
  newThreadDestination,
  accountSettingsDestination,
  settingsDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { useVoiceInputControl } from "../conversation/VoiceInputControl";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";
import type {
  ThreadCatalogPartition,
  ThreadCatalogSnapshot,
} from "../../application/resources/threadCatalogResource";
import { useAppDialog } from "../../ui/AppDialog";
import { presentThreadListRow, threadIsPinned } from "./threadListRow";
import { useThreadListActions } from "./useThreadListActions";
import { serverConnectionLabel } from "../serverList/serverConnectionPresentation";
import { replaceServerSelection } from "../navigation/serverSelectionNavigation";
import {
  CatalogSearchResource,
  type CatalogSearchEntry,
  type CatalogSearchSnapshot,
} from "../../application/resources/catalogSearchResource";

const ACCOUNTS_QUERY = { kind: "accounts.list" } as const;

interface ThreadListScreenProps {
  savedServerId: SavedServerId;
}

interface ProjectedThreadListProps extends ThreadListScreenProps {
  resource: ProjectionResource;
}

export function ThreadListScreen(props: ThreadListScreenProps): React.JSX.Element {
  const { savedServerId } = props;
  const runtime = useV2Runtime();
  const [outer, setOuter] = useState(() => runtime.projection(savedServerId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const retry = useEvent(() => setOuter(runtime.projection(savedServerId)));
  if (opened.value === null) {
    return (
      <ResourceStateView
        message={
          opened.status === "error"
            ? (opened.message ?? "Could not open saved server")
            : "Connecting to server…"
        }
        onRetry={retry}
        status={opened.status === "error" ? "error" : "loading"}
      />
    );
  }
  return <ProjectedThreadList resource={opened.value} savedServerId={savedServerId} />;
}

function ProjectedThreadList(props: ProjectedThreadListProps): React.JSX.Element {
  const { resource, savedServerId } = props;
  const runtime = useV2Runtime();
  const alert = useAppDialog();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const [catalog] = useState(() => runtime.threadCatalog(savedServerId, resource));
  const catalogSnapshot = useSyncExternalStore(
    catalog.subscribe,
    catalog.snapshot,
    catalog.snapshot,
  );
  const [catalogSearch] = useState(
    () =>
      new CatalogSearchResource({
        availability: runtime.connectionStatuses,
        execute: (id, request) => runtime.queries.execute(id, request),
      }),
  );
  const searchSnapshot = useSyncExternalStore(
    catalogSearch.subscribe,
    catalogSearch.snapshot,
    catalogSearch.snapshot,
  );
  const pins = useSyncExternalStore(
    runtime.threadPins.subscribe,
    runtime.threadPins.snapshot,
    runtime.threadPins.snapshot,
  );
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const connectionStatuses = useSyncExternalStore(
    runtime.connectionStatuses.subscribe,
    runtime.connectionStatuses.snapshot,
    runtime.connectionStatuses.snapshot,
  );
  const accounts = useLiveQuery(runtime, savedServerId, ACCOUNTS_QUERY);
  const retained = snapshot.value.projections.live === null;
  const searchOnline = connectionStatuses.value.get(savedServerId)?.state === "connected";
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const [query, setQuery] = useState("");
  const addServer = useEvent(() => router.push(newSavedServerDestination()));
  const createThread = useEvent(() => router.push(newThreadDestination(savedServerId)));
  const openAll = useEvent(() => replaceServerSelection(null));
  const openGlobalSettings = useEvent(() => router.push(settingsDestination()));
  const openAccounts = useEvent(() => router.push(accountSettingsDestination(savedServerId)));
  const openServer = useEvent((id: string) => {
    const candidate = servers.value.find((value) => value.id === id);
    if (candidate === undefined || candidate.id === savedServerId) return;
    replaceServerSelection(candidate.id);
  });
  const openThread = useEvent((id: string) => {
    router.push(threadDestination(qualifiedThread(savedServerId, threadId(id))));
  });
  const prewarmThread = useEvent((id: string) => {
    runtime.projection(savedServerId, threadId(id)).start();
  });
  const changeQuery = useEvent((value: string) => {
    setQuery(value);
    catalogSearch
      .search(value, server?.enabled === true ? [savedServerId] : [])
      .catch(() => undefined);
  });
  const resolveOwner = useEvent((id: string) => qualifiedThread(savedServerId, threadId(id)));
  const actions = useThreadListActions({ capabilities: runtime, resolveOwner });
  const showActionError = useEvent((message: string) => alert("Thread action failed", message));
  const loadMore = useEvent((partition: ThreadCatalogPartition) => {
    if (query.trim() !== "") return catalogSearch.loadMore(partition);
    return catalog.loadMore(partition);
  });
  const retryServers = useEvent(() => runtime.savedServers.refresh());
  const voice = useVoiceInputControl({
    audience: savedServerId,
    live: snapshot.value.state === "live" && snapshot.value.projections.live !== null,
    onTranscript: changeQuery,
    projection: snapshot.value.projections.live,
    scope: { id: `thread-search:${savedServerId}`, kind: "generic" },
    thread: null,
  });
  const serverPins = pins.value.get(savedServerId);
  const catalogEntries = mergeSingleServerSearch(
    savedServerId,
    catalogSnapshot.value.active,
    catalogSnapshot.value.archived,
    searchSnapshot.value,
    query.trim() !== "" && searchOnline,
  );
  const rows = catalogEntries.map((entry) => ({
    ...presentThreadListRow({
      pinned: threadIsPinned(serverPins, threadId(entry.thread.id)),
      retained:
        retained || (!entry.searchResult && catalog.coverage(entry.thread.id) !== "current"),
      thread: entry.thread,
    }),
    ...(entry.searchResult ? { authoritativeSearchMatch: true } : {}),
  }));
  const selectorRows = servers.value.map((candidate) => ({
    detail: serverConnectionLabel(connectionStatuses.value.get(candidate.id), candidate.enabled),
    emoji: candidate.emoji,
    id: candidate.id,
    label: candidate.displayName,
  }));
  return (
    <ThreadSidebarView
      actions={actions}
      connectionState={snapshot.value.state}
      onActionError={showActionError}
      onChangeQuery={changeQuery}
      onNewThread={createThread}
      onOpen={openThread}
      onPrewarm={prewarmThread}
      paging={threadListPaging(query, catalogSnapshot.value, searchSnapshot.value, loadMore)}
      query={query}
      rows={rows}
      usageAccounts={accountUsagePresentation(accounts.value, runtime.now())}
      usageActions={[
        {
          description: "Profiles and usage limits",
          icon: "people",
          id: "accounts",
          label: "Manage accounts",
          onPress: openAccounts,
        },
      ]}
      title={
        <ServerSelectorView
          activeId={savedServerId}
          detail={connectionStateLabel(snapshot.value.state)}
          heading={server?.displayName ?? "Server"}
          onAdd={addServer}
          onOpenAll={openAll}
          onOpen={openServer}
          onRetry={retryServers}
          onSettings={openGlobalSettings}
          rows={selectorRows}
          {...(servers.status === "error" ? { error: servers.message } : {})}
        />
      }
      voice={voice}
    />
  );
}

interface SingleServerSearchEntry {
  searchResult: boolean;
  thread: CatalogSearchEntry["thread"];
}

function mergeSingleServerSearch(
  savedServerId: SavedServerId,
  active: CatalogSearchEntry["thread"][],
  archived: CatalogSearchEntry["thread"][],
  search: CatalogSearchSnapshot,
  remote: boolean,
): SingleServerSearchEntry[] {
  const entries = new Map<string, SingleServerSearchEntry>();
  if (!remote) {
    for (const thread of [...active, ...archived]) {
      entries.set(thread.id, { searchResult: false, thread });
    }
  }
  if (remote) {
    for (const entry of [...search.active, ...search.archived]) {
      if (entry.savedServerId === savedServerId) {
        entries.set(entry.thread.id, { searchResult: true, thread: entry.thread });
      }
    }
  }
  return [...entries.values()].sort(
    (left, right) => threadTimestamp(right.thread) - threadTimestamp(left.thread),
  );
}

function threadListPaging(
  query: string,
  catalog: ThreadCatalogSnapshot,
  search: CatalogSearchSnapshot,
  loadMore: (partition: ThreadCatalogPartition) => Promise<void>,
) {
  if (query.trim() === "") {
    return {
      active: {
        canLoadMore: catalog.canLoadMore.active,
        error: catalog.errors.active,
        loading: catalog.loading.active,
      },
      archived: {
        canLoadMore: catalog.canLoadMore.archived,
        error: catalog.errors.archived,
        loading: catalog.loading.archived,
      },
      loadMore,
    };
  }
  return {
    active: searchPaging(search, "active"),
    archived: searchPaging(search, "archived"),
    loadMore,
  };
}

function searchPaging(search: CatalogSearchSnapshot, partition: ThreadCatalogPartition) {
  return {
    canLoadMore: search.canLoadMore[partition],
    error: search.errors[partition],
    loading: search.loading[partition],
    loadingLabel: "Searching threads…",
  };
}

function threadTimestamp(thread: CatalogSearchEntry["thread"]): number {
  return Date.parse(thread.lastActivityAt ?? thread.updatedAt);
}

function connectionStateLabel(state: string): string {
  if (state === "live") return "Live";
  if (state === "retained") return "Connecting";
  return state.charAt(0).toUpperCase() + state.slice(1);
}
