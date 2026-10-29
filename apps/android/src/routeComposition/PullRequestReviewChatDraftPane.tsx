import { useRouter } from "expo-router";
import { View } from "react-native";

import type { ReviewChatWorkspaceCandidate } from "../data/forgeMutationContract";
import { workspaceRuntime } from "../data/workspace-runtime";
import { ActiveWorkspaceConversation } from "../features/conversation/ConversationWorkspace";
import type { DraftAdmission } from "../features/conversation/ConversationWorkspace.types";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../features/conversation/conversationRouteNavigation";
import type { NewChatProjectPickerBinding } from "../features/projects/NewChatProjectPicker";
import { workspaceFeatures as features } from "../features/workspace/createWorkspaceFeatures";
import { WorkspaceConversationProviders } from "../features/workspace/WorkspaceConversationProviders";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { pullRequestReviewChatStyles as styles } from "./PullRequestReviewChatPane.styles";
import type { ReviewChatDraft } from "./reviewChatDraft";
import { ReviewChatScenarioNotice } from "./ReviewChatScenarioNotice";
import type { ReviewChatDraftCommands } from "./usePullRequestReviewChat";
import type { WorkspacePaneChrome } from "./workspacePanes";

const REASON_LABELS: Readonly<Record<ReviewChatWorkspaceCandidate["reason"], string>> = {
  pullRequestBranch: "Has the PR branch",
  repository: "Same repository",
};

const ignoreRoute = (): void => undefined;

/**
 * A draft has no thread, so it opens no thread-child destination. Composer tool screens belong
 * to the shared new chat's single draft and stay closed here until the chat exists.
 */
const DRAFT_NAVIGATION: ConversationRouteNavigation = {
  openAgents: ignoreRoute,
  openAttachments: ignoreRoute,
  openChanges: ignoreRoute,
  openCodeDocument: ignoreRoute,
  openContent: ignoreRoute,
  openDocument: ignoreRoute,
  openDrawing: ignoreRoute,
  openTaskOutput: ignoreRoute,
  openTerminal: ignoreRoute,
  openTool: ignoreRoute,
  openTurnChanges: ignoreRoute,
};

/** The review chat is always declared closable; outside a pane nothing can close it. */
function ignoreClose(): void {}

/**
 * The review chat of a PR without one, presented through the shared new-chat draft: its empty
 * state, project control and composer. The route hosts the draft: projects are limited to the
 * PR's server, the Companion's suggestions lead the explicit-choice picker, there is no server
 * default, and the first send creates the chat in the chosen project.
 */
export function PullRequestReviewChatDraftPane({
  chrome,
  commands,
  connectionId,
  draft,
}: {
  readonly chrome: WorkspacePaneChrome;
  readonly commands: ReviewChatDraftCommands;
  readonly connectionId: string;
  readonly draft: ReviewChatDraft;
}): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
  const picker: NewChatProjectPickerBinding = {
    confirmation: {
      actionLabel: "Use this project",
      suggestions: (draft.suggestions ?? []).map((candidate) => ({
        destination: { connectionId, cwd: candidate.path },
        reason: REASON_LABELS[candidate.reason],
      })),
    },
    connections: resources.connections.filter((connection) => connection.id === connectionId),
    current: draft.cwd === null ? null : { connectionId, cwd: draft.cwd },
    initialConnectionId: connectionId,
    native: workspaceRuntime.native,
    // Choosing only updates the draft; nothing is created until the first send.
    // WHY: the shared picker awaits a selection to show its pending state; choosing a draft's
    // project is local and completes at once, because nothing is created until the first send.
    // oxlint-disable-next-line typescript/require-await
    onSelect: async (destination) => {
      if (destination.cwd !== null) {
        commands.chooseProject(destination.cwd);
      }
    },
    remote: features.projects,
    servers: resources.list.servers.filter((server) => server.id === connectionId),
  };
  const admission: DraftAdmission = {
    kind: "hosted",
    notice:
      draft.scenario === null ? null : (
        <ReviewChatScenarioNotice
          onStart={commands.startScenario}
          projectChosen={draft.cwd !== null}
          scenario={draft.scenario}
        />
      ),
    picker,
    send: draft.cwd === null ? null : commands.send,
    suggesting: draft.suggestions === null,
  };
  return (
    <View style={styles.draftPane} testID="pull-request-chat-draft">
      <ConversationRouteNavigationContext.Provider value={DRAFT_NAVIGATION}>
        <DraftConversation
          admission={admission}
          chrome={chrome}
          commands={commands}
          connectionId={connectionId}
          draft={draft}
        />
      </ConversationRouteNavigationContext.Provider>
    </View>
  );
}

/** The shared conversation surface bound to the hosted draft and the right pane's chrome. */
function DraftConversation({
  admission,
  chrome,
  commands,
  connectionId,
  draft,
}: {
  readonly admission: DraftAdmission;
  readonly chrome: WorkspacePaneChrome;
  readonly commands: ReviewChatDraftCommands;
  readonly connectionId: string;
  readonly draft: ReviewChatDraft;
}): React.JSX.Element {
  const router = useRouter();
  const resources = useWorkspaceRouteResources();
  const onClose = chrome.close ?? ignoreClose;
  return (
    <WorkspaceConversationProviders
      activeConnectionId={connectionId}
      composerThreadId={draft.id}
      feedback={resources.browserFeedback}
      initialBrowserDestination=""
      runtime={resources.runtime}
    >
      <ActiveWorkspaceConversation
        connections={resources.connections}
        desktop={false}
        destination={{
          admission,
          draft: { connectionId, cwd: draft.cwd, id: draft.id, workspaceMode: "current" },
          kind: "draft",
        }}
        features={features}
        fileTransferController={workspaceRuntime.fileTransferController}
        loadedThreadSummaries={resources.list.loadedThreadSummaries}
        native={workspaceRuntime.native}
        onChangeDraftProject={(_draftId, cwd) => {
          if (cwd !== null) {
            commands.chooseProject(cwd);
          }
        }}
        onChangeDraftWorkspaceMode={() => undefined}
        onClose={onClose}
        onDraftAdmitted={() => undefined}
        onExitSearchHistory={onClose}
        onFixUnsupportedBlock={resources.recovery.createUnsupportedFixThread}
        onManageProjects={() => {
          router.push("/projects");
        }}
        onOpenBrowser={resources.openBrowser}
        onOpenBrowserInThread={resources.openBrowserInThread}
        onSelectThread={resources.list.selectThread}
        onShowActiveThreads={() => {
          resources.list.listState.setThreadListMode("active");
        }}
        pendingRequests={resources.pendingRequests}
        presentation={{
          closeLabel: "Close review chat",
          kind: "pane",
          menuItems: chrome.menuItems,
        }}
        runtime={resources.runtime}
        scopedThreads={resources.list.scopedThreads}
        servers={resources.list.servers}
        voiceController={workspaceRuntime.voiceController}
      />
    </WorkspaceConversationProviders>
  );
}
