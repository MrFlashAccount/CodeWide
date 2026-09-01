import { router, usePathname } from "expo-router";
import { useState, useSyncExternalStore, type PropsWithChildren } from "react";

import { SavedServerWorkspaceView } from "../../presentation/layouts/AdaptiveWorkspaceView";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { ThreadSidebarView } from "../../presentation/navigation/ThreadSidebarView";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { SavedServerId, ThreadId } from "../../domain/ids";
import { threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { useV2Runtime } from "../../V2Application";
import {
  newThreadDestination,
  serverDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { useEvent } from "../../../react/useEvent";
import { threadListCopy } from "../threadList/threadListPresentation";
import { useVoiceInputControl } from "../conversation/VoiceInputControl";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";

const ACCOUNTS_QUERY = { kind: "accounts.list" } as const;

interface SavedServerWorkspaceChromeProps {
  savedServerId: SavedServerId;
  selectedThreadId: ThreadId | null;
}

interface ProjectedSavedServerWorkspaceProps extends SavedServerWorkspaceChromeProps {
  resource: ProjectionResource;
}

export function SavedServerWorkspaceChrome(
  props: PropsWithChildren<SavedServerWorkspaceChromeProps>,
): React.JSX.Element {
  const { children, savedServerId, selectedThreadId } = props;
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
  return (
    <ProjectedSavedServerWorkspace
      resource={opened.value}
      savedServerId={savedServerId}
      selectedThreadId={selectedThreadId}
    >
      {children}
    </ProjectedSavedServerWorkspace>
  );
}

function ProjectedSavedServerWorkspace(
  props: PropsWithChildren<ProjectedSavedServerWorkspaceProps>,
): React.JSX.Element {
  const { children, resource, savedServerId, selectedThreadId } = props;
  const runtime = useV2Runtime();
  const pathname = usePathname();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const accounts = useLiveQuery(runtime, savedServerId, ACCOUNTS_QUERY);
  const server = servers.value.find((candidate) => candidate.id === savedServerId);
  const [query, setQuery] = useState("");
  const rows = (projection?.catalog ?? []).map((threadRecord) => {
    const { thread } = threadRecord;
    const copy = threadListCopy(thread);
    return {
      archived: thread.archived,
      id: thread.id,
      preview: copy.preview,
      retained: snapshot.value.projections.live === null,
      state: thread.state,
      title: copy.title,
      updatedAt: formatThreadTime(thread.lastActivityAt ?? thread.updatedAt),
    };
  });
  const createThread = useEvent(() => router.push(newThreadDestination(savedServerId)));
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
  return (
    <SavedServerWorkspaceView
      emptyMain={pathname === serverDestination(savedServerId)}
      sidebar={
        <ThreadSidebarView
          connectionState={snapshot.value.state}
          onChangeQuery={changeQuery}
          onNewThread={createThread}
          onOpen={openThread}
          query={query}
          rows={rows}
          usageAccounts={accountUsagePresentation(accounts.value, runtime.now())}
          {...(selectedThreadId === null ? {} : { selectedId: selectedThreadId })}
          title={server?.displayName ?? "Server"}
          voice={voice}
        />
      }
    >
      {children}
    </SavedServerWorkspaceView>
  );
}

function formatThreadTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
