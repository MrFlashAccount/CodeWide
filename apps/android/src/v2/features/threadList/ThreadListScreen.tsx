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
  newThreadDestination,
  serverDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { threadListCopy } from "./threadListPresentation";
import { useVoiceInputControl } from "../conversation/VoiceInputControl";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";

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
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const accounts = useLiveQuery(runtime, savedServerId, ACCOUNTS_QUERY);
  const retained = snapshot.value.projections.live === null;
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const [query, setQuery] = useState("");
  const addServer = useEvent(() => router.push("/settings/servers/new"));
  const createThread = useEvent(() => router.push(newThreadDestination(savedServerId)));
  const openAll = useEvent(() => router.push("/servers"));
  const openGlobalSettings = useEvent(() => router.push("/settings"));
  const openServer = useEvent((id: string) => {
    const candidate = servers.value.find((value) => value.id === id);
    if (candidate !== undefined) router.replace(serverDestination(candidate.id));
  });
  const openThread = useEvent((id: string) => {
    router.push(threadDestination(qualifiedThread(savedServerId, threadId(id))));
  });
  const changeQuery = useEvent((value: string) => setQuery(value));
  const voice = useVoiceInputControl({
    audience: savedServerId,
    live: snapshot.value.state === "live" && snapshot.value.projections.live !== null,
    onTranscript: changeQuery,
    projection: snapshot.value.projections.live,
    scope: { id: `thread-search:${savedServerId}`, kind: "generic" },
    thread: null,
  });
  const rows = (projection?.catalog ?? []).map((value) => {
    const { thread } = value;
    const copy = threadListCopy(thread);
    return {
      archived: thread.archived,
      id: thread.id,
      preview: copy.preview,
      retained,
      state: thread.state,
      title: copy.title,
      updatedAt: formatThreadTime(thread.lastActivityAt ?? thread.updatedAt),
    };
  });
  const selectorRows = servers.value.map((candidate) => ({
    detail: candidate.enabled ? "Live" : "Disabled",
    emoji: candidate.emoji,
    id: candidate.id,
    label: candidate.displayName,
  }));
  return (
    <ThreadSidebarView
      connectionState={snapshot.value.state}
      onChangeQuery={changeQuery}
      onNewThread={createThread}
      onOpen={openThread}
      query={query}
      rows={rows}
      usageAccounts={accountUsagePresentation(accounts.value, runtime.now())}
      title={
        <ServerSelectorView
          activeId={savedServerId}
          detail={connectionStateLabel(snapshot.value.state)}
          heading={server?.displayName ?? "Server"}
          onAdd={addServer}
          onOpenAll={openAll}
          onOpen={openServer}
          onSettings={openGlobalSettings}
          rows={selectorRows}
        />
      }
      voice={voice}
    />
  );
}

function connectionStateLabel(state: string): string {
  if (state === "live") return "Live";
  if (state === "retained") return "Connecting";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
