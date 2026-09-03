import { router } from "expo-router";
import { useState, useSyncExternalStore, type ComponentProps } from "react";
import { useWindowDimensions } from "react-native";

import { useV2Runtime } from "../../V2Application";
import {
  newSavedServerDestination,
  newThreadDestination,
  settingsDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { ThreadCatalogWorkspaceView } from "../../presentation/layouts/AdaptiveWorkspaceView";
import { isDesktopWindow } from "../../presentation/layouts/windowLayout";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import type { ThreadListRow } from "../../presentation/navigation/ThreadListView";
import {
  NewThreadServerPickerView,
  ServerSelectorView,
} from "../../presentation/navigation/ServerSelectorView";
import { ThreadSidebarView } from "../../presentation/navigation/ThreadSidebarView";
import { useEvent } from "../../../react/useEvent";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { threadId, type SavedServerId } from "../../domain/ids";
import { useAppDialog } from "../../ui/AppDialog";
import { presentThreadListRow, threadIsPinned } from "../threadList/threadListRow";
import { useThreadListActions } from "../threadList/useThreadListActions";
import type { ThreadCatalogPartition } from "../../application/resources/threadCatalogResource";
import {
  aggregateConnectionLabel,
  aggregateConnectionState,
  serverConnectionLabel,
} from "./serverConnectionPresentation";
import { replaceServerSelection } from "../navigation/serverSelectionNavigation";
import type {
  AggregateThreadCatalogEntry,
  AggregateThreadCatalogSnapshot,
} from "../../application/resources/aggregateThreadCatalogResource";
import {
  CatalogSearchResource,
  type CatalogSearchSnapshot,
} from "../../application/resources/catalogSearchResource";
import { useSavedServerVoiceInputControl } from "../conversation/VoiceInputControl";

interface AggregateThreadListRow extends ThreadListRow {
  savedServerId: SavedServerId;
  threadId: ReturnType<typeof threadId>;
  updatedAtMs: number;
}

interface AggregateSearchEntry extends AggregateThreadCatalogEntry {
  searchResult: boolean;
}

export function ServerListScreen(): React.JSX.Element {
  const runtime = useV2Runtime();
  const alert = useAppDialog();
  const window = useWindowDimensions();
  const desktop = isDesktopWindow(window);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const catalog = runtime.aggregateThreadCatalog;
  const catalogSnapshot = useSyncExternalStore(
    catalog.subscribe,
    catalog.snapshot,
    catalog.snapshot,
  );
  const pins = useSyncExternalStore(
    runtime.threadPins.subscribe,
    runtime.threadPins.snapshot,
    runtime.threadPins.snapshot,
  );
  const connectionStatuses = useSyncExternalStore(
    runtime.connectionStatuses.subscribe,
    runtime.connectionStatuses.snapshot,
    runtime.connectionStatuses.snapshot,
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
  const [query, setQuery] = useState("");
  const enabledServers = servers.value.filter((server) => server.enabled);
  const searchableServers: SavedServerId[] = [];
  for (const server of enabledServers) {
    if (connectionStatuses.value.get(server.id)?.state === "connected") {
      searchableServers.push(server.id);
    }
  }
  const catalogEntries = mergeAggregateSearch(
    catalogSnapshot.value,
    searchSnapshot.value,
    query.trim() !== "",
    new Set(searchableServers),
  );
  const rows = catalogEntries
    .map((entry) => {
      const ownerSavedServerId = entry.savedServerId;
      const ownerThreadId = threadId(entry.thread.id);
      return {
        ...presentThreadListRow({
          displayId: JSON.stringify([ownerSavedServerId, ownerThreadId]),
          pinned: threadIsPinned(pins.value.get(ownerSavedServerId), ownerThreadId),
          retained:
            entry.coverage !== "current" ||
            connectionStatuses.value.get(ownerSavedServerId)?.state !== "connected",
          thread: entry.thread,
        }),
        ...(entry.searchResult ? { authoritativeSearchMatch: true } : {}),
        savedServerId: ownerSavedServerId,
        threadId: ownerThreadId,
        updatedAtMs: Date.parse(entry.thread.lastActivityAt ?? entry.thread.updatedAt),
      };
    })
    .sort(compareThreads);
  const addServer = useEvent(() => router.push(newSavedServerDestination()));
  const [newThreadPickerOpen, setNewThreadPickerOpen] = useState(false);
  const createThread = useEvent(() => {
    if (enabledServers.length === 0) {
      router.push(newSavedServerDestination());
      return;
    }
    setNewThreadPickerOpen(true);
  });
  const changeNewThreadPicker = useEvent((open: boolean) => setNewThreadPickerOpen(open));
  const createThreadOnServer = useEvent((id: string) => {
    const server = enabledServers.find((candidate) => candidate.id === id);
    if (server !== undefined) router.push(newThreadDestination(server.id));
  });
  const keepAllSelected = useEvent(() => undefined);
  const openSettings = useEvent(() => router.push(settingsDestination()));
  const openServer = useEvent((id: string) => {
    const server = servers.value.find((candidate) => candidate.id === id);
    if (server !== undefined) replaceServerSelection(server.id);
  });
  const openThread = useEvent((id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined) return;
    router.push(threadDestination(qualifiedThread(row.savedServerId, threadId(row.threadId))));
  });
  const prewarmThread = useEvent((id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined) return;
    runtime.projection(row.savedServerId, row.threadId).start();
  });
  const resolveOwner = useEvent((id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    return row === undefined ? null : qualifiedThread(row.savedServerId, row.threadId);
  });
  const actions = useThreadListActions({ capabilities: runtime, resolveOwner });
  const showActionError = useEvent((message: string) => alert("Thread action failed", message));
  const changeQuery = useEvent((value: string) => {
    setQuery(value);
    catalogSearch
      .search(
        value,
        enabledServers.map((server) => server.id),
      )
      .catch(() => undefined);
  });
  const loadMore = useEvent((partition: ThreadCatalogPartition) => {
    if (query.trim() !== "") return catalogSearch.loadMore(partition);
    return catalog.loadMore(partition);
  });
  const selectorRows = servers.value.map((server) => ({
    detail: serverConnectionLabel(connectionStatuses.value.get(server.id), server.enabled),
    emoji: server.emoji,
    id: server.id,
    label: server.displayName,
  }));
  const retryCatalog = useEvent(async (): Promise<void> => {
    await runtime.savedServers.refresh();
    await Promise.all([
      runtime.aggregate.refresh(),
      catalog.loadMore("active"),
      catalog.loadMore("archived"),
    ]);
  });
  if (servers.status !== "ready" && servers.value.length === 0) {
    return (
      <ResourceStateView
        message={servers.status === "error" ? servers.message : "Loading saved servers…"}
        onRetry={retryCatalog}
        status={servers.status === "error" ? "error" : "loading"}
      />
    );
  }
  if (catalogSnapshot.status !== "ready" && catalogEntries.length === 0) {
    return (
      <ResourceStateView
        message={catalogSnapshot.status === "error" ? catalogSnapshot.message : "Loading threads…"}
        onRetry={retryCatalog}
        status={catalogSnapshot.status === "error" ? "error" : "loading"}
      />
    );
  }
  const aggregateState = aggregateConnectionState(servers.value, connectionStatuses.value);
  const sidebarProps: ComponentProps<typeof ThreadSidebarView> & {
    onChangeQuery(query: string): void;
  } = {
    actions,
    connectionState: aggregateState,
    onActionError: showActionError,
    onChangeQuery: changeQuery,
    onNewThread: createThread,
    onOpen: openThread,
    onPrewarm: prewarmThread,
    paging: aggregateThreadListPaging(query, catalogSnapshot.value, searchSnapshot.value, loadMore),
    query,
    rows,
    title: desktop ? (
      "Server"
    ) : (
      <ServerSelectorView
        detail={aggregateConnectionLabel(servers.value, connectionStatuses.value)}
        heading="All threads"
        onAdd={addServer}
        onOpenAll={keepAllSelected}
        onOpen={openServer}
        onRetry={retryCatalog}
        onSettings={openSettings}
        rows={selectorRows}
        {...(servers.status === "error" ? { error: servers.message } : {})}
      />
    ),
  };
  const voiceAudience = searchableServers[0];
  return (
    <>
      <ThreadCatalogWorkspaceView
        catalog={
          voiceAudience === undefined ? (
            <ThreadSidebarView {...sidebarProps} />
          ) : (
            <AggregateVoiceThreadSidebar
              sidebarProps={sidebarProps}
              voiceAudience={voiceAudience}
            />
          )
        }
      />
      <NewThreadServerPickerView
        isOpen={newThreadPickerOpen}
        onAdd={addServer}
        onOpenChange={changeNewThreadPicker}
        onSelect={createThreadOnServer}
        rows={selectorRows.filter((row) => enabledServers.some((server) => server.id === row.id))}
      />
    </>
  );
}

interface AggregateVoiceThreadSidebarProps {
  sidebarProps: ComponentProps<typeof ThreadSidebarView> & {
    onChangeQuery(query: string): void;
  };
  voiceAudience: SavedServerId;
}

function AggregateVoiceThreadSidebar(props: AggregateVoiceThreadSidebarProps): React.JSX.Element {
  const { sidebarProps, voiceAudience } = props;
  const voice = useSavedServerVoiceInputControl({
    audience: voiceAudience,
    onTranscript: sidebarProps.onChangeQuery,
    scope: { id: "thread-search:all", kind: "generic" },
    thread: null,
  });
  return <ThreadSidebarView {...sidebarProps} voice={voice} />;
}

function mergeAggregateSearch(
  catalog: AggregateThreadCatalogSnapshot,
  search: CatalogSearchSnapshot,
  queryActive: boolean,
  searchableServers: Set<SavedServerId>,
): AggregateSearchEntry[] {
  const entries = new Map<string, AggregateSearchEntry>();
  for (const entry of [...catalog.active, ...catalog.archived]) {
    if (!queryActive || !searchableServers.has(entry.savedServerId)) {
      entries.set(aggregateEntryKey(entry.savedServerId, entry.thread.id), {
        ...entry,
        searchResult: false,
      });
    }
  }
  for (const entry of [...search.active, ...search.archived]) {
    if (queryActive && searchableServers.has(entry.savedServerId)) {
      entries.set(aggregateEntryKey(entry.savedServerId, entry.thread.id), {
        coverage: "current",
        savedServerId: entry.savedServerId,
        searchResult: true,
        thread: entry.thread,
      });
    }
  }
  return [...entries.values()];
}

function aggregateThreadListPaging(
  query: string,
  catalog: AggregateThreadCatalogSnapshot,
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
    active: aggregateSearchPaging(search, "active"),
    archived: aggregateSearchPaging(search, "archived"),
    loadMore,
  };
}

function aggregateSearchPaging(search: CatalogSearchSnapshot, partition: ThreadCatalogPartition) {
  return {
    canLoadMore: search.canLoadMore[partition],
    error: search.errors[partition],
    loading: search.loading[partition],
    loadingLabel: "Searching all servers…",
  };
}

function aggregateEntryKey(savedServerId: SavedServerId, threadId: string): string {
  return JSON.stringify([savedServerId, threadId]);
}

function compareThreads(left: AggregateThreadListRow, right: AggregateThreadListRow): number {
  return right.updatedAtMs - left.updatedAtMs;
}
