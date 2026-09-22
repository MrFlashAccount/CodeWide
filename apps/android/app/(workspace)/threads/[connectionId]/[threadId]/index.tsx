import { useLocalSearchParams, useRouter } from "expo-router";

import { RouteUnavailable } from "../../../../../src/components/navigation/RouteUnavailable";
import { workspaceRuntime } from "../../../../../src/data/workspace-runtime";
import { ActiveWorkspaceConversation } from "../../../../../src/features/conversation/ConversationWorkspace";
import { workspaceFeatures as features } from "../../../../../src/features/workspace/createWorkspaceFeatures";
import { WorkspaceConversationProviders } from "../../../../../src/features/workspace/WorkspaceConversationProviders";
import { searchRouteSessions } from "../../../../../src/services/search/searchRouteSession";
import { newThreadService } from "../../../../../src/services/threads/newThreadService";
import { useEvent } from "../../../../../src/react/useEvent";
import {
  routeSessionIdParam,
  threadRouteSessionOwner,
  v1ThreadDestination,
  v1ThreadRouteParams,
} from "../../../../../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../../../../../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../../../../../src/services/workspace/workspaceRouteResources";

type SearchRoute = {
  readonly sessionId: string | null;
  readonly window: ReturnType<typeof searchRouteSessions.window>;
};

function resolveSearchRoute(
  rawSessionId: string | readonly string[] | undefined,
  params: ReturnType<typeof v1ThreadRouteParams>,
): SearchRoute {
  if (rawSessionId === undefined || params.status === "invalid") {
    return { sessionId: null, window: null };
  }
  const parsed = routeSessionIdParam(rawSessionId);
  if (parsed.status === "invalid") {
    return { sessionId: null, window: null };
  }
  const window = searchRouteSessions.window(
    parsed.value.value,
    threadRouteSessionOwner(params.value),
  );
  return { sessionId: window === null ? null : parsed.value.value, window };
}

/** Composes one qualified V1 thread from validated route parameters and retained resources. */
export default function V1ThreadRoute(): React.JSX.Element {
  const router = useRouter();
  const raw = useLocalSearchParams<{
    connectionId?: string | string[];
    globalSearchSessionId?: string | string[];
    searchWindowId?: string | string[];
    threadId?: string | string[];
  }>();
  const params = v1ThreadRouteParams(raw);
  const resources = useWorkspaceRouteResources();
  const closeDraft = useEvent((draftId: string): void => {
    newThreadService.close(draftId);
  });
  const searchRoute = resolveSearchRoute(raw.searchWindowId, params);
  useRouteSessionLifetime(
    searchRoute.sessionId,
    (windowId) => {
      searchRouteSessions.closeWindow(windowId);
    },
    (windowId) =>
      params.status === "valid"
        ? searchRouteSessions.retainWindow(windowId, threadRouteSessionOwner(params.value))
        : () => undefined,
  );
  if (params.status === "invalid") {
    return (
      <RouteUnavailable
        message="This thread link is invalid."
        onBack={() => {
          router.dismissTo("/");
        }}
        title="Thread unavailable"
      />
    );
  }
  if (
    !resources.connections.some((connection) => connection.id === params.value.connectionId.value)
  ) {
    return (
      <RouteUnavailable
        message="The server for this thread is no longer available."
        onBack={() => {
          router.dismissTo("/");
        }}
        title="Server unavailable"
      />
    );
  }
  const closeSearchHistory = (): void => {
    if (searchRoute.sessionId !== null) {
      searchRouteSessions.closeWindow(searchRoute.sessionId);
    }
    const destination = v1ThreadDestination(params.value);
    const globalSearchSessionId = routeSessionIdParam(raw.globalSearchSessionId);
    router.replace({
      ...destination,
      params: {
        ...destination.params,
        ...(globalSearchSessionId.status === "valid"
          ? { globalSearchSessionId: globalSearchSessionId.value.value }
          : {}),
      },
    });
  };
  const connectionId = params.value.connectionId.value;
  const threadId = params.value.threadId.value;
  return (
    <WorkspaceConversationProviders
      activeConnectionId={connectionId}
      composerThreadId={threadId}
      feedback={resources.browserFeedback}
      initialBrowserDestination={`${connectionId}\u0000${threadId}`}
      runtime={resources.runtime}
    >
      <ActiveWorkspaceConversation
        connections={resources.connections}
        desktop={resources.desktop}
        destination={{
          connectionId,
          kind: "thread",
          searchWindow: searchRoute.window,
          threadId,
        }}
        features={features}
        fileTransferController={workspaceRuntime.fileTransferController}
        loadedThreadSummaries={resources.list.loadedThreadSummaries}
        native={workspaceRuntime.native}
        onChangeDraftProject={() => undefined}
        onChangeDraftWorkspaceMode={() => undefined}
        onClose={resources.list.closeActiveThread}
        onDraftAdmitted={closeDraft}
        onExitSearchHistory={closeSearchHistory}
        onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
        onManageProjects={() => {
          router.push("/projects");
        }}
        onOpenBrowser={resources.openBrowser}
        onSelectThread={resources.list.selectThread}
        onShowActiveThreads={() => {
          resources.list.listState.setThreadListMode("active");
        }}
        pendingRequests={resources.pendingRequests}
        runtime={resources.runtime}
        scopedThreads={resources.list.scopedThreads}
        servers={resources.list.servers}
        voiceController={workspaceRuntime.voiceController}
      />
    </WorkspaceConversationProviders>
  );
}
