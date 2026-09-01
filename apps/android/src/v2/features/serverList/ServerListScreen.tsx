import { router } from "expo-router";
import { useSyncExternalStore } from "react";

import { useV2Runtime } from "../../V2Application";
import {
  newThreadDestination,
  serverDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { ThreadCatalogWorkspaceView } from "../../../presentation/layouts/AdaptiveWorkspaceView";
import type { ThreadListRow } from "../../../presentation/navigation/ThreadListView";
import { ServerSelectorView } from "../../../presentation/navigation/ServerSelectorView";
import { ThreadSidebarView } from "../../../presentation/navigation/ThreadSidebarView";
import { useEvent } from "../../../react/useEvent";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { savedServerId, threadId, type SavedServerId } from "../../domain/ids";
import { threadListCopy } from "../threadList/threadListPresentation";

interface AggregateThreadListRow extends ThreadListRow {
  savedServerId: SavedServerId;
  threadId: string;
}

export function ServerListScreen(): React.JSX.Element {
  const runtime = useV2Runtime();
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const aggregate = useSyncExternalStore(
    runtime.aggregate.subscribe,
    runtime.aggregate.snapshot,
    runtime.aggregate.snapshot,
  );
  const rows = aggregate.value.threads
    .map(({ entry, identity }) => {
      const copy = threadListCopy(entry.thread);
      return {
        archived: entry.thread.archived,
        emoji:
          servers.value.find((server) => String(server.id) === String(identity.savedServerId))
            ?.emoji ?? "🖥️",
        id: JSON.stringify([identity.savedServerId, identity.threadId]),
        preview: copy.preview,
        retained: false,
        savedServerId: savedServerId(identity.savedServerId),
        state: entry.thread.state,
        threadId: identity.threadId,
        title: copy.title,
        updatedAt: entry.thread.updatedAt,
      };
    })
    .sort(compareThreads)
    .map((row) => ({ ...row, updatedAt: formatThreadTime(row.updatedAt) }));
  const addServer = useEvent(() => router.push("/settings/servers/new"));
  const createThread = useEvent(() => {
    const server = servers.value.find((candidate) => candidate.enabled);
    if (server === undefined) router.push("/settings/servers/new");
    else router.push(newThreadDestination(server.id));
  });
  const keepAllSelected = useEvent(() => undefined);
  const openSettings = useEvent(() => router.push("/settings"));
  const openServer = useEvent((id: string) => {
    const server = servers.value.find((candidate) => candidate.id === id);
    if (server !== undefined) router.push(serverDestination(server.id));
  });
  const openThread = useEvent((id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined) return;
    router.push(threadDestination(qualifiedThread(row.savedServerId, threadId(row.threadId))));
  });
  const selectorRows = servers.value.map((server) => ({
    detail: server.enabled ? "Connected" : "Disabled",
    emoji: server.emoji,
    id: server.id,
    label: server.displayName,
  }));
  return (
    <ThreadCatalogWorkspaceView
      catalog={
        <ThreadSidebarView
          connectionState="live"
          onNewThread={createThread}
          onOpen={openThread}
          rows={rows}
          title={
            <ServerSelectorView
              detail={`${servers.value.length} ${servers.value.length === 1 ? "server" : "servers"}`}
              heading="All threads"
              onAdd={addServer}
              onOpenAll={keepAllSelected}
              onOpen={openServer}
              onSettings={openSettings}
              rows={selectorRows}
            />
          }
        />
      }
    />
  );
}

function compareThreads(left: AggregateThreadListRow, right: AggregateThreadListRow): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
