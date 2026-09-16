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
import { threadRouteGeneration } from "../../../../../src/services/threads/threadNavigationService";
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
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onBack={() => {
          router.dismissTo("/v1");
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
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onBack={() => {
          router.dismissTo("/v1");
        }}
        title="Server unavailable"
      />
    );
  }
  const closeSearchHistory = (): void => {
    if (searchRoute.sessionId !== null) {
      searchRouteSessions.closeWindow(searchRoute.sessionId);
    }
    router.replace(v1ThreadDestination(params.value));
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
        // WHY: The destination is derived from validated route params; React Compiler owns its render identity.
        // oxlint-disable-next-line react-doctor/jsx-no-new-object-as-prop
        destination={{
          connectionId,
          generation: threadRouteGeneration(params.value),
          kind: "thread",
          searchWindow: searchRoute.window,
          threadId,
        }}
        features={features}
        fileTransferController={workspaceRuntime.fileTransferController}
        loadedThreadSummaries={resources.list.loadedThreadSummaries}
        native={workspaceRuntime.native}
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onChangeDraftProject={() => undefined}
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onChangeDraftWorkspaceMode={() => undefined}
        onClose={resources.list.closeActiveThread}
        onDraftAdmitted={closeDraft}
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onExitSearchHistory={closeSearchHistory}
        onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
        onManageProjects={() => {
          router.push("/v1/projects");
        }}
        onOpenBrowser={resources.openBrowser}
        onSelectThread={resources.list.selectThread}
        // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
        // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
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
