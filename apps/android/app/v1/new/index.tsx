import { useSelector } from "@legendapp/state/react";
import { useIsFocused, useRouter } from "expo-router";

import { workspaceRuntime } from "../../../src/data/workspace-runtime";
import { ActiveWorkspaceConversation } from "../../../src/features/conversation/ConversationWorkspace";
import { ConversationRouteNavigationContext } from "../../../src/features/conversation/conversationRouteNavigation";
import { NewThreadServerSheet } from "../../../src/features/projects/NewThreadServerSheet";
import { workspaceFeatures as features } from "../../../src/features/workspace/createWorkspaceFeatures";
import { WorkspaceConversationProviders } from "../../../src/features/workspace/WorkspaceConversationProviders";
import { newThreadService } from "../../../src/services/threads/newThreadService";
import { contentRouteSessions } from "../../../src/services/content/contentRouteSession";
import { drawingRouteSessions } from "../../../src/services/drawing/drawingRouteSession";
import { documentRouteService } from "../../../src/services/documents/documentRouteService";
import { useWorkspaceRouteResources } from "../../../src/services/workspace/workspaceRouteResources";
import { composerToolRouteSessions } from "../../../src/services/composer/composerToolRouteSession";
import { changesRouteSessions } from "../../../src/services/changes/changesRouteSession";
import { useEvent } from "../../../src/react/useEvent";
import type { ConversationRouteNavigation } from "../../../src/features/conversation/conversationRouteNavigation";
import { draftRouteSessionOwner } from "../../../src/services/threads/threadRouteParams";

const ignoreRoute = (): void => undefined;

/** Composes the private V1 draft resource or asks for its server qualification. */
export default function V1NewThreadRoute(): React.JSX.Element {
  const router = useRouter();
  const visible = useIsFocused();
  const resources = useWorkspaceRouteResources();
  const draft = useSelector(() => newThreadService.draft$.get());
  const owner = draft === null ? null : draftRouteSessionOwner(draft.id);
  const closeDraft = useEvent((draftId: string): void => {
    newThreadService.close(draftId);
  });
  const openCodeDocument = useEvent<ConversationRouteNavigation["openCodeDocument"]>((request) => {
    if (owner === null) {
      return;
    }
    const session = changesRouteSessions.open(owner, request);
    router.push({
      params: { sessionId: session.id },
      pathname: "/v1/new/documents/[sessionId]",
    });
  });
  const openContent = useEvent<ConversationRouteNavigation["openContent"]>((request) => {
    if (owner === null) {
      return;
    }
    const session = contentRouteSessions.open(owner, request);
    router.push({ params: { sessionId: session.id }, pathname: "/v1/new/content/[sessionId]" });
  });
  const openDocument = useEvent<ConversationRouteNavigation["openDocument"]>((request) => {
    if (owner === null) {
      return;
    }
    const session = documentRouteService.open(owner, request);
    router.push({ params: { sessionId: session.id }, pathname: "/v1/new/documents/[sessionId]" });
  });
  const openDrawing = useEvent<ConversationRouteNavigation["openDrawing"]>((request) => {
    if (owner === null) {
      return;
    }
    const result = drawingRouteSessions.open(owner, request);
    if (result.status === "admitted") {
      router.push({
        params: { sessionId: result.session.id },
        pathname: "/v1/drawing/[sessionId]",
      });
    }
  });
  const openTool = useEvent<ConversationRouteNavigation["openTool"]>((request) => {
    if (owner === null) {
      return;
    }
    if (request.kind !== "model" && request.kind !== "skills" && request.kind !== "permissions") {
      return;
    }
    const session = composerToolRouteSessions.open(owner, request);
    const pathname =
      request.kind === "model"
        ? "/v1/new/controls/model"
        : request.kind === "skills"
          ? "/v1/new/controls/skills"
          : "/v1/new/controls/permissions";
    router.push({ params: { sessionId: session.id }, pathname });
  });
  const routeNavigation: ConversationRouteNavigation = {
    openAgents: ignoreRoute,
    openAttachments: ignoreRoute,
    openChanges: ignoreRoute,
    openCodeDocument,
    openContent,
    openDocument,
    openDrawing,
    openTerminal: ignoreRoute,
    openTool,
    openTurnChanges: ignoreRoute,
  };
  const destination = draft === null ? null : { draft, kind: "draft" as const };
  if (draft === null) {
    return (
      <NewThreadServerSheet
        onClose={() => {
          router.dismissTo("/v1");
        }}
        // WHY: This render-local callback must return a Promise because the picker action contract is async.
        // oxlint-disable-next-line typescript/promise-function-async
        onSelect={(connectionId) => {
          resources.openNewThread(
            connectionId,
            resources.project.projectWorkspace.defaultProjectCwd(connectionId),
          );
          return Promise.resolve();
        }}
        servers={resources.list.servers}
        visible={visible}
      />
    );
  }
  const close = (): void => {
    newThreadService.close(draft.id);
    router.dismissTo("/v1");
  };
  if (destination === null) {
    throw new Error("The V1 draft destination disappeared during render");
  }
  return (
    <ConversationRouteNavigationContext.Provider value={routeNavigation}>
      <WorkspaceConversationProviders
        activeConnectionId={draft.connectionId}
        composerThreadId={draft.id}
        feedback={resources.browserFeedback}
        initialBrowserDestination=""
        runtime={resources.runtime}
      >
        <ActiveWorkspaceConversation
          connections={resources.connections}
          desktop={resources.desktop}
          destination={destination}
          features={features}
          fileTransferController={workspaceRuntime.fileTransferController}
          loadedThreadSummaries={resources.list.loadedThreadSummaries}
          native={workspaceRuntime.native}
          onChangeDraftProject={(draftId, cwd) => {
            newThreadService.changeProject(draftId, cwd);
          }}
          onChangeDraftWorkspaceMode={(draftId, mode) => {
            newThreadService.changeWorkspaceMode(draftId, mode);
          }}
          onClose={close}
          onDraftAdmitted={closeDraft}
          onExitSearchHistory={close}
          onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
          onManageProjects={() => {
            router.push("/v1/projects");
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
    </ConversationRouteNavigationContext.Provider>
  );
}
