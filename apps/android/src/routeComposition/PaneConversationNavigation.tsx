import { useIsFocused, useRouter } from "expo-router";
import { useRef, useState, type ReactNode } from "react";

import { RouteUnavailable } from "../components/navigation/RouteUnavailable";
import { RouteCodeDocumentReview } from "../features/changes/RouteCodeDocumentReview";
import { CurrentChangesRoute, TurnChangesRoute } from "../features/changes/RouteChangesWorkspace";
import { useTurnChangesLoader } from "../features/changes/turnChanges";
import { RouteDocumentPreview } from "../features/attachments/RouteDocumentPreview";
import { ConversationRouteFullscreenOverlay } from "../features/conversation/ConversationRouteFullscreenOverlay";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../features/conversation/conversationRouteNavigation";
import { BackgroundTaskOutputScreen } from "../features/conversation/turns/BackgroundTaskOutputScreen";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import type { DocumentPreviewRequest } from "../rendering/DocumentPreviewHost";
import type { AgentRouteRequest } from "../services/agents/agentRouteSession";
import type { AttachmentRouteRequest } from "../services/attachments/attachmentRouteSession";
import type { TaskOutputRouteRequest } from "../services/backgroundTasks/taskOutputRouteSession";
import type {
  CodeDocumentRouteRequest,
  CurrentChangesRouteRequest,
  TurnChangesRouteRequest,
} from "../services/changes/changesRouteSession";
import type { ComposerToolRouteRequest } from "../services/composer/composerToolRouteSession";
import type { LargeContentRouteRequest } from "../services/content/contentRouteSession";
import type { TerminalRouteRequest } from "../services/terminal/terminalRouteSession";
import {
  threadRouteSessionOwner,
  type V1ThreadRouteParams,
} from "../services/threads/threadRouteParams";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import {
  AttachmentsDestination,
  ComposerToolDestination,
  ContentDestination,
  SubagentsDestination,
} from "./ConversationDestinations";
import { pushDrawingRoute } from "./threadRouteNavigation";

/** One destination a pane-hosted conversation opened, with the request captured at that moment. */
type PaneConversationDestination =
  | { readonly kind: "agents"; readonly request: AgentRouteRequest }
  | { readonly kind: "attachments"; readonly request: AttachmentRouteRequest }
  | { readonly kind: "changes"; readonly request: CurrentChangesRouteRequest }
  | {
      readonly kind: "codeDocument";
      readonly request: CodeDocumentRouteRequest;
    }
  | { readonly kind: "content"; readonly request: LargeContentRouteRequest }
  | { readonly kind: "document"; readonly request: DocumentPreviewRequest }
  | { readonly kind: "taskOutput"; readonly request: TaskOutputRouteRequest }
  | { readonly kind: "terminal"; readonly request: TerminalRouteRequest }
  | { readonly kind: "tool"; readonly request: ComposerToolRouteRequest }
  | { readonly kind: "turnChanges"; readonly request: TurnChangesRouteRequest };

type PaneDestinationEntry = {
  readonly destination: PaneConversationDestination;
  readonly id: string;
};

/** Reads the feature at call time, so importing this module evaluates no workspace feature. */
async function loadTurnItems(connectionId: string, threadId: string, turnId: string) {
  return features.conversation.loadTurnItems(connectionId, threadId, turnId);
}

/**
 * Supplies the conversation navigation intents of a conversation that a pane hosts outside the
 * Threads route tree (a PR's review chat). The thread child routes live under `/threads/...` in
 * the Threads tab, so pushing them would leave the hosting route; here every destination opens
 * over the mounted host instead: fullscreen destinations as their own application fullscreen
 * window, tool and attachment sheets as their native sheet windows. Entries form one stack in
 * opening order: a later entry covers an earlier one, and closing an entry also closes the
 * entries opened above it. A drawing keeps its workspace-root modal route, which covers both tabs
 * without switching them.
 */
export function PaneConversationNavigationProvider({
  children,
  thread,
}: {
  readonly children: ReactNode;
  readonly thread: V1ThreadRouteParams;
}): React.JSX.Element {
  const router = useRouter();
  const [entries, setEntries] = useState<readonly PaneDestinationEntry[]>([]);
  const nextEntryId = useRef(0);
  const open = (destination: PaneConversationDestination): void => {
    nextEntryId.current += 1;
    const entry: PaneDestinationEntry = {
      destination,
      id: `pane-destination-${String(nextEntryId.current)}`,
    };
    setEntries((current) => [...current, entry]);
  };
  const close = useEvent((id: string): void => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      return index === -1 ? current : current.slice(0, index);
    });
  });
  const openAgents = useEvent<ConversationRouteNavigation["openAgents"]>((request) => {
    open({ kind: "agents", request });
  });
  const openAttachments = useEvent<ConversationRouteNavigation["openAttachments"]>((request) => {
    open({ kind: "attachments", request });
  });
  const openChanges = useEvent<ConversationRouteNavigation["openChanges"]>((request) => {
    open({ kind: "changes", request });
  });
  const openCodeDocument = useEvent<ConversationRouteNavigation["openCodeDocument"]>((request) => {
    open({ kind: "codeDocument", request });
  });
  const openContent = useEvent<ConversationRouteNavigation["openContent"]>((request) => {
    open({ kind: "content", request });
  });
  const openDocument = useEvent<ConversationRouteNavigation["openDocument"]>((request) => {
    open({ kind: "document", request });
  });
  const openDrawing = useEvent<ConversationRouteNavigation["openDrawing"]>((request) => {
    pushDrawingRoute(router, {
      owner: threadRouteSessionOwner(thread),
      request,
      routeParams: { connectionId: thread.connectionId.value, threadId: thread.threadId.value },
    });
  });
  const openTaskOutput = useEvent<ConversationRouteNavigation["openTaskOutput"]>((request) => {
    open({ kind: "taskOutput", request });
  });
  const openTerminal = useEvent<ConversationRouteNavigation["openTerminal"]>((request) => {
    open({ kind: "terminal", request });
  });
  const openTool = useEvent<ConversationRouteNavigation["openTool"]>((request) => {
    open({ kind: "tool", request });
  });
  const openTurnChanges = useEvent<ConversationRouteNavigation["openTurnChanges"]>((request) => {
    open({ kind: "turnChanges", request });
  });
  const navigation: ConversationRouteNavigation = {
    openAgents,
    openAttachments,
    openChanges,
    openCodeDocument,
    openContent,
    openDocument,
    openDrawing,
    openTaskOutput,
    openTerminal,
    openTool,
    openTurnChanges,
  };
  return (
    <ConversationRouteNavigationContext.Provider value={navigation}>
      {children}
      {entries.map((entry, index) => (
        <PaneDestination
          connectionId={thread.connectionId.value}
          entry={entry}
          key={entry.id}
          navigation={navigation}
          onClose={close}
          threadId={thread.threadId.value}
          top={index === entries.length - 1}
        />
      ))}
    </ConversationRouteNavigationContext.Provider>
  );
}

/** Presents one stacked entry; a sheet shows only while it is the top entry of a focused host. */
function PaneDestination({
  connectionId,
  entry,
  navigation,
  onClose,
  threadId,
  top,
}: {
  readonly connectionId: string;
  readonly entry: PaneDestinationEntry;
  readonly navigation: ConversationRouteNavigation;
  readonly onClose: (id: string) => void;
  readonly threadId: string;
  readonly top: boolean;
}): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
  const focused = useIsFocused();
  const close = (): void => {
    onClose(entry.id);
  };
  const destination = entry.destination;
  switch (destination.kind) {
    case "tool":
      return (
        <ComposerToolDestination
          onClose={close}
          request={destination.request}
          visible={focused && top}
        />
      );
    case "attachments":
      return (
        <AttachmentsDestination
          connectionId={connectionId}
          onClose={close}
          onOpenCodeDocument={destination.request.openCodeDocument}
          onOpenDocument={navigation.openDocument}
          resources={resources}
          threadId={threadId}
          visible={focused && top}
        />
      );
    case "agents":
      return (
        <PaneSubagents
          connectionId={connectionId}
          id={entry.id}
          onClose={close}
          request={destination.request}
        />
      );
    case "changes":
    case "codeDocument":
    case "content":
    case "document":
    case "taskOutput":
    case "terminal":
    case "turnChanges":
      break;
  }
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={close}
      render={(closeOverlay) => (
        <FullscreenDestination
          closeOverlay={closeOverlay}
          connectionId={connectionId}
          destination={destination}
          navigation={navigation}
          opening={entry.id}
          resources={resources}
        />
      )}
      scope={`pane-${destination.kind}:${entry.id}`}
    />
  );
}

type FullscreenPaneDestination = Exclude<
  PaneConversationDestination,
  { readonly kind: "agents" | "attachments" | "tool" }
>;

/** The content of one fullscreen entry, rendered inside its application fullscreen window. */
function FullscreenDestination({
  closeOverlay,
  connectionId,
  destination,
  navigation,
  opening,
  resources,
}: {
  readonly closeOverlay: () => void;
  readonly connectionId: string;
  readonly destination: FullscreenPaneDestination;
  readonly navigation: ConversationRouteNavigation;
  readonly opening: string;
  readonly resources: ReturnType<typeof useWorkspaceRouteResources>;
}): React.JSX.Element {
  switch (destination.kind) {
    case "changes":
      return <CurrentChangesRoute onClose={closeOverlay} request={destination.request} />;
    case "turnChanges":
      return <TurnChangesRoute onClose={closeOverlay} request={destination.request} />;
    case "codeDocument":
      return <RouteCodeDocumentReview onClose={closeOverlay} request={destination.request} />;
    case "content":
      return (
        <ContentDestination
          connectionId={connectionId}
          database={resources.runtime.threadDetails}
          onClose={closeOverlay}
          request={destination.request}
        />
      );
    case "document":
      return (
        <RouteDocumentPreview
          onClose={closeOverlay}
          onOpenDocument={navigation.openDocument}
          request={destination.request}
        />
      );
    case "taskOutput":
      return (
        <BackgroundTaskOutputScreen
          onClose={closeOverlay}
          opening={opening}
          request={destination.request}
        />
      );
    case "terminal":
      break;
  }
  return (
    <TerminalWorkspace
      connectionId={destination.request.connectionId}
      cwd={destination.request.cwd}
      onMinimize={closeOverlay}
      threadId={destination.request.threadId}
    />
  );
}

/** The subagent workspace entry; it owns the turn-changes loader its conversations read. */
function PaneSubagents({
  connectionId,
  id,
  onClose,
  request,
}: {
  readonly connectionId: string;
  readonly id: string;
  readonly onClose: () => void;
  readonly request: AgentRouteRequest;
}): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
  const { loadTurnChanges } = useTurnChangesLoader(loadTurnItems);
  const threadDetails = resources.runtime.threadDetails;
  return (
    <ConversationRouteFullscreenOverlay
      onDismiss={onClose}
      render={(closeOverlay) =>
        threadDetails === null ? (
          <RouteUnavailable
            message="Thread details are not ready."
            onBack={closeOverlay}
            title="Subagents unavailable"
          />
        ) : (
          <SubagentsDestination
            connectionId={connectionId}
            initialThreadId={null}
            loadTurnChanges={loadTurnChanges}
            onClose={closeOverlay}
            request={request}
            resources={resources}
            threadDetails={threadDetails}
          />
        )
      }
      scope={`pane-agents:${id}`}
    />
  );
}
