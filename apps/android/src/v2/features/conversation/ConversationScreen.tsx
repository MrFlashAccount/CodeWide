import type {
  V2Attachment,
  V2Command,
  V2CommandTerminalFrame,
  V2InputBlock,
  V2Item,
  V2PendingRequest,
  V2Query,
  V2QueryResult,
  V2ThreadSettings,
  V2ThreadWindow,
} from "@codewide/sync-client/v2";
import { setStringAsync } from "expo-clipboard";
import { router } from "expo-router";
import { useReducer, useState, useSyncExternalStore, useTransition } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { V2ChatComposer } from "../../V2ChatComposer";
import type { ComposerAttachmentDraft } from "../../application/composer/composerAttachmentDraft";
import type { ComposerDraftLocalState } from "../../application/composer/composerAttachmentController";
import type {
  ComposerAttachmentDraftItem,
  ComposerSubmission,
} from "../../application/composer/composerAttachmentTypes";
import type { ComposerAttachmentTarget } from "../../application/ports/composerAttachmentTransport";
import { ActionSheetView, type ActionSheetItem } from "../../presentation/actions/ActionSheetView";
import { TopBarActionView } from "../../presentation/actions/TopBarActionView";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import {
  UsagePopoverView,
  type UsageAccountViewModel,
  type UsageContextViewModel,
  type UsageSessionViewModel,
} from "../../presentation/usage/UsagePopoverView";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import { MessageActionProviderView } from "../../presentation/conversation/MessageActionProviderView";
import type { CommandSettlement } from "../../application/commandCorrelation";
import { useLiveQuery } from "../../application/react/useLiveQuery";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { ResourceSnapshot } from "../../application/resources/resource";
import {
  ThreadHistoryResource,
  type ThreadHistoryRestoreCursor,
} from "../../application/resources/threadHistoryResource";
import { ThreadSearchResource } from "../../application/resources/threadSearchResource";
import type { V2Runtime } from "../../application/v2Runtime";
import { useTerminalContext } from "../../application/react/useTerminalContext";
import type { SkillCatalogEntry } from "../../application/skills/skillSelection";
import { insertSkillInvocation } from "../../application/skills/skillSelection";
import { threadId } from "../../domain/ids";
import { qualifiedThread, type QualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceSubtitleView, WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { ConversationView } from "../../presentation/conversation/ConversationView";
import { ConversationComposerDockView } from "../../presentation/conversation/ConversationComposerDockView";
import { ConversationSearchView } from "../../presentation/conversation/ConversationSearchView";
import {
  ContextRingView,
  contextRingActionStyle,
} from "../../presentation/conversation/ContextRingActionView";
import {
  TimelineView,
  type TimelineActivityActions,
  type TimelineDisplayResponseRow,
  type TimelineDisplayTurn,
  type TimelineTurnActions,
} from "../../presentation/conversation/TimelineView";
import {
  ComposerContextStripView,
  type ComposerContextItem,
} from "../../presentation/input/ComposerContextStripView";
import { ProductText } from "../../presentation/text/ProductText";
import { isDesktopWindow } from "../../presentation/layouts/windowLayout";
import { quickdrawImageSource } from "../../platform/drawing/quickdrawImageSource";
import { CostBreakdownPopover } from "../../presentation/usage/CostBreakdownPopover";
import { LiveTurnPlanPopover } from "../../presentation/usage/LiveTurnPlanPopover";
import type {
  LiveTurnPlanViewModel,
  UsageBreakdownViewModel,
} from "../../presentation/usage/usageTypes";
import { DeliveryModeSelectorView } from "../../presentation/queue/DeliveryModeSelectorView";
import type { QueueDeliveryMode } from "../../presentation/queue/queueTypes";
import {
  V2RenderingCapabilityProvider,
  type V2RenderingCapabilities,
} from "../../rendering/renderingCapabilities";
import { createV2RenderingCapabilities } from "./createV2RenderingCapabilities";
import { attachmentForReference } from "../attachments/attachmentReference";
import { DrawingWorkspace, type DrawingWorkspaceRequest } from "../drawing/DrawingWorkspace";
import { createAttachmentAnnotationCapability } from "../drawing/attachmentAnnotation";
import { drawingWorkspaceRequest } from "../drawing/drawingDraft";
import { ThreadGoalSheet } from "../goal/ThreadGoalSheet";
import {
  accountSettingsDestination,
  agentDestination,
  attachmentPreviewDestination,
  itemOutputDestination,
  newThreadDestination,
  reviewResponseDestination,
  threadDestination,
} from "../navigation/routeDestinations";
import { PendingRequestsPanel } from "../requests/PendingRequestsPanel";
import { QueueControlsFeature } from "../queue/QueueManagerFeature";
import { deliveryCommand } from "../queue/deliveryCommand";
import { StartReviewLaunchButton } from "../review/ReviewEntryActions";
import { SkillsSheet } from "../skills/SkillsSheet";
import { terminalComposerContextItem } from "../terminal/terminalComposerContextItem";
import { threadMarkReadCommand } from "../threadList/threadListCommands";
import { createTurnActions, turnActionAvailability } from "../turnActions/turnActions";
import type { EditPriorTurnReady, ReviewResponseRequest } from "../turnActions/turnActionTypes";
import { liveTurnPlanPresentation } from "../usage/liveTurnPlanPresentation";
import { usagePresentation } from "../usage/usagePresentation";
import {
  useVoiceInputControl,
  useVoiceInputLevel,
  type VoiceInputControlModel,
} from "./VoiceInputControl";
import { ConversationThreadMenu } from "./ConversationThreadMenu";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import {
  timelineResponseRowsDisplayModel,
  timelineTurnsDisplayModel,
} from "./timelineDisplayModel";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";
import { spacing } from "../../theme";
import {
  conversationPermissionContextItem,
  nextConversationPermissionSettings,
  threadSettingsUpdateCommand,
} from "./conversationPermissionContext";
import { unsupportedItemRecoveryPrompt } from "./unsupportedItemRecovery";

type ThreadResourceName = "agents" | "attachments" | "changes" | "terminal";
type ModelsResult = Extract<V2QueryResult, { kind: "models.list" }>;
type ThreadEffort = NonNullable<V2ThreadSettings["effort"]>;
type ResponseReviewNavigation = ReviewResponseRequest & { owner: QualifiedThread };

interface ComposerContextItemsInput {
  actionable: boolean;
  agentCount: number;
  modelsError: string | null;
  modelsLoading: boolean;
  modelsResult: V2QueryResult | null;
  onSelectModel(id: string): void;
  onSelectPermissions(id: string): void;
  portCount: number;
  resourcesResult: V2QueryResult | null;
  terminalItem: ComposerContextItem | null;
  settingsPending: boolean;
  threadWindow: V2ThreadWindow | null;
}

interface ThreadControlChipsInput {
  actionable: boolean;
  agentCount: number;
  modelsSnapshot: ResourceSnapshot<V2QueryResult | null>;
  owner: QualifiedThread;
  portCount: number;
  resourcesResult: V2QueryResult | null;
  runtime: V2Runtime;
  setError(message: string | null): void;
  settings: V2ThreadSettings | null;
  terminalItem: ComposerContextItem | null;
  threadWindow: V2ThreadWindow | null;
}

interface LockedComposerActivation {
  correlationId: string;
  operationId: string;
}

interface InitialHistoryRestore {
  cursor: ThreadHistoryRestoreCursor | null;
  turnId: string | null;
  viewportOffsetPx: number | null;
}

interface ConversationComposerState {
  clearVersion: number;
  error: string | null;
  lockedActivation: LockedComposerActivation | null;
  pendingInputBlocks: V2InputBlock[];
  terminalBlocked: boolean;
  text: string;
}

type ConversationComposerAction =
  | { kind: "addTranscript"; text: string }
  | { kind: "clearPendingInput" }
  | { kind: "edit" }
  | { kind: "editPriorTurn"; blocks: V2InputBlock[]; text: string }
  | { kind: "lock"; activation: LockedComposerActivation; message: string }
  | { kind: "releaseUnsettled" }
  | { kind: "selectSkill"; block: V2InputBlock; text: string }
  | { kind: "setError"; message: string | null }
  | { kind: "setText"; text: string }
  | { kind: "settled" }
  | { kind: "submitCompleted" }
  | { kind: "terminalFailure"; message: string }
  | { kind: "unlockWithError"; message: string };

const INITIAL_COMPOSER_STATE: ConversationComposerState = {
  clearVersion: 0,
  error: null,
  lockedActivation: null,
  pendingInputBlocks: [],
  terminalBlocked: false,
  text: "",
};

const ACCOUNTS_QUERY = { kind: "accounts.list" } as const;
const MODELS_QUERY = { kind: "models.list" } as const;

const RESOURCE_ACTIONS: ActionSheetItem[] = [
  {
    detail: "Files shared in this thread",
    icon: "attach",
    id: "attachments",
    label: "Attachments",
  },
  { detail: "Files changed by Codex", icon: "changes", id: "changes", label: "Changes" },
  { detail: "Open the thread terminal", icon: "terminal", id: "terminal", label: "Terminal" },
  { detail: "Open secure port forwarding", icon: "ports", id: "ports", label: "Ports" },
  { detail: "Open subagent threads", icon: "construct", id: "agents", label: "Subagents" },
];

const COMPOSER_ACTIONS: ActionMenuItem[] = [
  { icon: "attach-outline", id: "files", label: "Attach file" },
  { icon: "brush-outline", id: "drawing", label: "Drawing" },
  { icon: "terminal-outline", id: "terminal", label: "Terminal" },
  { icon: "git-network-outline", id: "ports", label: "Port forward" },
  { icon: "sparkles-outline", id: "skills", label: "Skills" },
  { icon: "flag-outline", id: "goal", label: "Goal" },
];

interface ConversationScreenProps {
  onBack(): void;
  onOpenPorts(): void | Promise<void>;
  onOpenResource(resourceName: ThreadResourceName): void | Promise<void>;
  owner: QualifiedThread;
}

interface ProjectedConversationProps extends ConversationScreenProps {
  resource: ProjectionResource;
}

export function ConversationScreen(props: ConversationScreenProps): React.JSX.Element {
  const { onBack, onOpenPorts, onOpenResource, owner } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(owner.savedServerId, owner.threadId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const retryOpening = useEvent((): Promise<void> => outer.refresh());
  if (opened.value === null) {
    return (
      <WorkspaceView title="Conversation">
        <ResourceStateView
          message={opened.status === "error" ? opened.message : "Opening conversation…"}
          onRetry={retryOpening}
          status={opened.status === "error" ? "error" : "loading"}
        />
      </WorkspaceView>
    );
  }
  return (
    <ProjectedConversation
      key={`${owner.savedServerId}:${owner.threadId}`}
      onBack={onBack}
      onOpenPorts={onOpenPorts}
      onOpenResource={onOpenResource}
      owner={owner}
      resource={opened.value}
    />
  );
}

function ProjectedConversation(props: ProjectedConversationProps): React.JSX.Element {
  const surface = useProjectedConversationSurface(props);
  return <ConversationSurface {...surface} />;
}

function useProjectedConversationSurface(
  props: ProjectedConversationProps,
): ConversationSurfaceProps {
  const { onBack, onOpenPorts, onOpenResource, owner, resource } = props;
  const runtime = useV2Runtime();
  const { height, width } = useWindowDimensions();
  const [ports] = useState(() => runtime.ports(owner.savedServerId));
  const portsSnapshot = useSyncExternalStore(ports.subscribe, ports.snapshot, ports.snapshot);
  const terminalContext = useTerminalContext(runtime.terminal, owner);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const refreshState = useSyncExternalStore(
    resource.subscribeRefresh,
    resource.refreshSnapshot,
    resource.refreshSnapshot,
  );
  const requestedThread = resource.requestedThreadAuthority();
  const threadAuthorityReady =
    requestedThread.threadId === owner.threadId && requestedThread.status === "ready";
  const threadLive =
    threadAuthorityReady &&
    snapshot.value.state === "live" &&
    snapshot.value.projections.live?.currentThread?.thread.id === owner.threadId;
  const retryThreadAuthority = useEvent(async (): Promise<void> => {
    await runtime.sessions.open(owner.savedServerId, owner.threadId);
  });
  const accountsSnapshot = useLiveQuery(runtime, owner.savedServerId, ACCOUNTS_QUERY);
  const modelsSnapshot = useLiveQuery(runtime, owner.savedServerId, MODELS_QUERY);
  const threadResourcesSnapshot = useLiveQuery(runtime, owner.savedServerId, {
    cursor: null,
    kind: "thread.resources",
    limit: 100,
    scope: "session",
    threadId: owner.threadId,
  });
  const threadAgentsSnapshot = useLiveQuery(runtime, owner.savedServerId, {
    cursor: null,
    kind: "thread.agents",
    limit: 100,
    threadId: owner.threadId,
  });
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const window =
    projection?.currentThread?.thread.id === owner.threadId ? projection.currentThread : null;
  const draftId = `thread:${owner.threadId}`;
  const attachmentTarget = {
    threadId: owner.threadId,
    workspace: window?.thread.workspace ?? null,
  };
  const composerDraftScope = {
    draftId,
    savedServerId: owner.savedServerId,
    target: attachmentTarget,
  };
  const [composerDraftState] = useState(() =>
    runtime.composerAttachments.state(composerDraftScope),
  );
  const localDraft = useSyncExternalStore(
    composerDraftState.subscribe,
    composerDraftState.snapshot,
    composerDraftState.snapshot,
  );
  const [initialHistoryRestore] = useState(() => historyRestore(localDraft.value));
  const executeHistoryQuery = useEvent(async (query: V2Query): Promise<V2QueryResult> =>
    runtime.queries.execute(owner.savedServerId, query),
  );
  const [historyResource] = useState(
    () =>
      new ThreadHistoryResource({
        execute: executeHistoryQuery,
        restoreCursor: initialHistoryRestore.cursor,
        source: resource,
        threadId: owner.threadId,
      }),
  );
  const historyObserved = useSyncExternalStore(
    historyResource.subscribe,
    historyResource.snapshot,
    historyResource.snapshot,
  );
  const history = { resource: historyResource, snapshot: historyObserved.value };
  const [searchResource] = useState(
    () =>
      new ThreadSearchResource({
        execute: executeHistoryQuery,
        source: historyResource,
        threadId: owner.threadId,
      }),
  );
  const searchObserved = useSyncExternalStore(
    searchResource.subscribe,
    searchResource.snapshot,
    searchResource.snapshot,
  );
  const search = searchObserved.value;
  const loadOlder = useEvent((): Promise<void> => history.resource.loadOlder());
  const loadNewer = useEvent((): Promise<void> => history.resource.loadNewer());
  const jumpToLatest = useEvent(() => history.resource.jumpToLatest());
  const loadActivity = useTurnActivityLoader(runtime, owner);
  const settleHistoryWindow = useEvent((direction: "newer" | "older") =>
    history.resource.settle(direction),
  );
  const [composerState, dispatchComposer] = useReducer(conversationComposerReducer, {
    ...INITIAL_COMPOSER_STATE,
    text: localDraft.value.text,
  });
  const composerError =
    composerState.error ?? (localDraft.status === "error" ? localDraft.message : null);
  const lockedActivation = composerState.lockedActivation;
  const terminalBlocked = composerState.terminalBlocked;
  const composerText = localDraft.value.text;
  const pendingInputBlocks = composerState.pendingInputBlocks;
  const clearVersion = composerState.clearVersion;
  const setComposerError = useEvent((message: string | null) => {
    dispatchComposer({ kind: "setError", message });
  });
  const setComposerText = useEvent((text: string) => {
    dispatchComposer({ kind: "setText", text });
    runtime.composerAttachments.setText(composerDraftScope, text);
  });
  const deliveryPreference: QueueDeliveryMode = localDraft.value.deliveryMode;
  const setDeliveryPreference = useEvent((mode: QueueDeliveryMode) => {
    runtime.composerAttachments.setDeliveryMode(composerDraftScope, mode);
  });
  const setHistoryAnchor = useEvent((turnId: string | null, viewportOffsetPx: number | null) => {
    const cursor = turnId === null ? null : history.resource.restoreCursorFor(turnId);
    runtime.composerAttachments.setHistoryPosition(composerDraftScope, {
      anchorOffsetPx: turnId === null ? null : viewportOffsetPx,
      anchorTurnId: turnId,
      generationId: cursor?.generationId ?? null,
      pageCursor: cursor?.cursor ?? null,
      pageDirection: cursor?.direction ?? null,
    });
  });
  const [drawingRequest, setDrawingRequest] = useState<DrawingWorkspaceRequest | null>(null);
  const [goalVisible, setGoalVisible] = useState(false);
  const [resourceMenuVisible, setResourceMenuVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [skillsVisible, setSkillsVisible] = useState(false);
  const attachmentDraft = runtime.composerAttachments.draft({
    ...composerDraftScope,
  });
  const drawingNow = useEvent(() => new Date(runtime.now()));
  const presentDrawing = useEvent((request: DrawingWorkspaceRequest) => {
    setDrawingRequest(request);
  });
  const annotateAttachment = createAttachmentAnnotationCapability({
    imageSource: quickdrawImageSource,
    now: drawingNow,
    present: presentDrawing,
  });
  const threadAttachments =
    threadResourcesSnapshot.value?.kind === "thread.resources"
      ? threadResourcesSnapshot.value.attachments
      : [];
  const renderingCapabilities = createV2RenderingCapabilities({
    annotate: annotateAttachment,
    attachments: threadAttachments,
    owner,
    ports,
    runtime,
  });
  const openActivityAttachment = useEvent((attachmentId: string) => {
    router.push(attachmentPreviewDestination({ attachmentId, owner }));
  });
  const openActivitySubagent = useEvent((agentThreadId: string) => {
    router.push(agentDestination(owner, agentThreadId));
  });
  const openActivityItemOutput = useEvent((turnId: string, itemId: string) => {
    router.push(itemOutputDestination(owner, turnId, itemId));
  });
  const copyUnsupportedActivity = useEvent(async (payloadJson: string) => {
    await setStringAsync(payloadJson);
  });
  const fixUnsupportedActivity = useEvent((sourceKind: string, payloadJson: string) => {
    const recoveryDraftScope = {
      draftId: `new-thread:${owner.savedServerId}`,
      savedServerId: owner.savedServerId,
      target: { threadId: null, workspace: null },
    };
    runtime.composerAttachments.setText(
      recoveryDraftScope,
      unsupportedItemRecoveryPrompt(sourceKind, payloadJson),
    );
    router.push(newThreadDestination(owner.savedServerId));
  });
  const activityActions: TimelineActivityActions = {
    onCopyUnsupported: copyUnsupportedActivity,
    onFixUnsupported: fixUnsupportedActivity,
    onOpenAttachment: openActivityAttachment,
    onOpenItemOutput: openActivityItemOutput,
    onOpenSubagent: openActivitySubagent,
  };
  const reviewAvailable =
    threadResourcesSnapshot.authority === "live" &&
    threadResourcesSnapshot.value?.kind === "thread.resources" &&
    threadResourcesSnapshot.value.review.targetKinds.length > 0 &&
    threadResourcesSnapshot.value.review.deliveries.length > 0;
  const receiveSettlement = useEvent((settlement: CommandSettlement) => {
    if (
      lockedActivation === null ||
      settlement.correlationId !== lockedActivation.correlationId ||
      settlement.operationId !== lockedActivation.operationId
    ) {
      return;
    }
    if (settlement.kind === "notCreated") {
      dispatchComposer({ kind: "unlockWithError", message: settlement.failure.message });
      return;
    }
    if (settlement.kind === "terminal") {
      if (completedComposerCommand(settlement.frame, owner.threadId)) {
        dispatchComposer({ kind: "settled" });
        runtime.composerAttachments.setText(composerDraftScope, "");
        attachmentDraft.clear();
        return;
      }
      dispatchComposer({
        kind: "terminalFailure",
        message: composerTerminalMessage(settlement.frame),
      });
    }
  });
  const [correlations] = useState(() =>
    runtime.commandCorrelations(
      {
        savedServerId: owner.savedServerId,
        surface: "threadComposer",
        threadId: owner.threadId,
      },
      receiveSettlement,
    ),
  );
  const correlationSnapshot = useSyncExternalStore(
    correlations.subscribe,
    correlations.snapshot,
    correlations.snapshot,
  );
  const unsettledCorrelationIds = new Set(
    correlationSnapshot.value.map((value) => {
      const { correlationId } = value;
      return correlationId;
    }),
  );
  if (lockedActivation !== null) unsettledCorrelationIds.add(lockedActivation.correlationId);
  const unsettledCount = unsettledCorrelationIds.size;
  const locallyLocked = correlations.isScopeLocked();
  const unsettledBlockingCount = correlations.blockingCount();
  const releaseUnsettled = useEvent(async (): Promise<void> => {
    await correlations.releaseBlocking();
    dispatchComposer({ kind: "releaseUnsettled" });
  });
  const editComposer = useEvent(() => {
    dispatchComposer({ kind: "edit" });
  });
  const addTranscript = useEvent((text: string) => {
    dispatchComposer({ kind: "addTranscript", text });
    runtime.composerAttachments.setText(
      composerDraftScope,
      composerText.trim() === "" ? text : `${composerText.trimEnd()}\n${text}`,
    );
  });
  const closeResourceMenu = useEvent(() => setResourceMenuVisible(false));
  const closeDrawing = useEvent(() => setDrawingRequest(null));
  const closeGoal = useEvent(() => setGoalVisible(false));
  const closeSkills = useEvent(() => setSkillsVisible(false));
  const completeDrawing = useEvent(() => setDrawingRequest(null));
  const editDrawing = useEvent((item: ComposerAttachmentDraftItem) => {
    const request = drawingWorkspaceRequest(item);
    if (request === null) {
      setComposerError("This attachment cannot be edited.");
      return;
    }
    setDrawingRequest(request);
  });
  const selectSkill = useEvent((skill: SkillCatalogEntry) => {
    const inserted = insertSkillInvocation(
      composerText,
      { end: composerText.length, start: composerText.length },
      skill,
    );
    dispatchComposer({ kind: "selectSkill", block: inserted.block, text: inserted.text });
    runtime.composerAttachments.setText(composerDraftScope, inserted.text);
  });
  const openThreadResource = useEvent(async (id: ThreadResourceName): Promise<void> => {
    await onOpenResource(id);
  });
  const changeSearchQuery = useEvent((query: string) => searchResource.setQuery(query));
  const moveSearchNewer = useEvent(() => {
    searchResource.moveNewer().catch(() => undefined);
  });
  const moveSearchOlder = useEvent(() => {
    searchResource.moveOlder().catch(() => undefined);
  });
  const closeSearch = useEvent(() => {
    searchResource.setQuery("");
    setSearchVisible(false);
  });
  const toggleSearch = useEvent(() => {
    if (searchVisible) closeSearch();
    else setSearchVisible(true);
  });
  const selectResource = useEvent((id: string) => {
    if (id === "ports") {
      setResourceMenuVisible(false);
      Promise.resolve(onOpenPorts()).catch(() => setComposerError("Could not open ports."));
      return;
    }
    if (!isThreadResourceName(id)) return;
    setResourceMenuVisible(false);
    openThreadResource(id).catch(() => setComposerError("Could not open thread resource."));
  });
  const selectComposerAction = useEvent((id: string) => {
    if (id === "files") {
      openThreadResource("attachments").catch(() =>
        setComposerError("Could not open attachments."),
      );
      return;
    }
    if (id === "terminal") {
      openThreadResource("terminal").catch(() => setComposerError("Could not open terminal."));
      return;
    }
    if (id === "ports") {
      Promise.resolve(onOpenPorts()).catch(() => setComposerError("Could not open ports."));
      return;
    }
    if (id === "skills") {
      setSkillsVisible(true);
      return;
    }
    if (id === "drawing") {
      setDrawingRequest({ draftItemId: null, initialSnapshot: null, mode: "drawing" });
      return;
    }
    if (id === "goal") setGoalVisible(true);
  });
  const openContext = useEvent((id: string) => {
    if (isThreadResourceName(id)) {
      openThreadResource(id).catch(() => setComposerError("Could not open thread resource."));
    } else if (id === "ports") {
      Promise.resolve(onOpenPorts()).catch(() => setComposerError("Could not open ports."));
    } else setResourceMenuVisible(true);
  });
  const agentCount =
    threadAgentsSnapshot.authority === "live" &&
    threadAgentsSnapshot.value.kind === "thread.agents" &&
    threadAgentsSnapshot.value.threadId === owner.threadId
      ? threadAgentsSnapshot.value.agents.length
      : 0;
  const contextItems = useThreadControlChips({
    actionable: threadLive,
    agentCount,
    modelsSnapshot,
    owner,
    portCount: portsSnapshot.value.ports.length,
    resourcesResult: threadResourcesSnapshot.value,
    runtime,
    setError: setComposerError,
    settings: window?.thread.settings ?? null,
    terminalItem: terminalComposerContextItem(terminalContext),
    threadWindow: window,
  });
  const searchActive = searchVisible && search.query !== "";
  const historyRestoreIdentity =
    initialHistoryRestore.cursor === null
      ? "initial"
      : history.snapshot.restoreCursor === null
        ? "restoring"
        : `restored:${initialHistoryRestore.turnId ?? "unknown"}`;
  const timelineSourceTurns = searchActive ? search.turns : history.snapshot.turns;
  const timelineTurns = timelineTurnsDisplayModel(timelineSourceTurns, threadAttachments);
  const usage = usagePresentation({ turns: history.snapshot.turns });
  const livePlan = liveTurnPlanPresentation(history.snapshot.turns);
  const searchMatchIds = new Set(search.matchTurnIds);
  const visibleTimelineTurns = searchActive
    ? timelineTurns.filter((turn) => searchMatchIds.has(turn.id))
    : timelineTurns;
  const changeHistoryAnchor = useEvent((turnId: string | null, viewportOffsetPx: number | null) => {
    if (!searchActive) setHistoryAnchor(turnId, viewportOffsetPx);
  });
  const unreadMarker =
    window?.thread.readState?.kind === "unread"
      ? window.thread.readState.latestActivityMarker
      : null;
  const markLatestVisibleRead = useEvent(async (marker: string): Promise<void> => {
    if (!threadLive) throw new Error("Conversation is not ready for mutations");
    const frame = await runtime.commandActivations.execute(
      owner.savedServerId,
      threadMarkReadCommand(owner, marker),
    );
    if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
  });
  const activeTurnId = latestActiveTurnId(window?.turns ?? []);
  const threadRunning = activeTurnId !== null;
  const deliveryMode = effectiveDeliveryMode(deliveryPreference, threadRunning, activeTurnId);
  const submitInput = useEvent(async (input: V2InputBlock[]): Promise<boolean> => {
    if (!threadLive) {
      setComposerError("Conversation is still connecting.");
      return false;
    }
    dispatchComposer({ kind: "setError", message: null });
    const submit: Extract<V2Command, { kind: "turn.submit" }> = {
      input,
      intent: "chat",
      kind: "turn.submit",
      settings: null,
      threadId: owner.threadId,
      workspace: null,
    };
    let command: V2Command;
    try {
      command = deliveryCommand({ activeTurnId, mode: deliveryMode, submit, threadRunning });
    } catch (cause: unknown) {
      setComposerError(errorMessage(cause, "Could not prepare message delivery."));
      return false;
    }
    const settlement = await runtime.commands
      .executeCorrelated(
        {
          savedServerId: owner.savedServerId,
          surface: "threadComposer",
          threadId: owner.threadId,
        },
        command,
      )
      .catch(() => null);
    if (settlement === null) {
      setComposerError("Action failed. Try again.");
      return false;
    }
    if (settlement.kind === "notCreated") {
      dispatchComposer({ kind: "unlockWithError", message: settlement.failure.message });
      return false;
    }
    if (settlement.kind === "durableUnsettled") {
      correlations.retainLock(settlement);
      dispatchComposer({
        activation: {
          correlationId: settlement.correlationId,
          operationId: settlement.operationId,
        },
        kind: "lock",
        message: settlement.failure.message,
      });
      return false;
    }
    if (!completedComposerCommand(settlement.frame, owner.threadId)) {
      dispatchComposer({
        kind: "terminalFailure",
        message: composerTerminalMessage(settlement.frame),
      });
      return false;
    }
    dispatchComposer({ kind: "submitCompleted" });
    return true;
  });
  const submitComposer = useEvent(async (submission: ComposerSubmission): Promise<boolean> => {
    let prepared: V2InputBlock[];
    try {
      prepared = await submission.prepareInput(attachmentTarget);
    } catch (cause: unknown) {
      setComposerError(errorMessage(cause, "Could not prepare attachments."));
      return false;
    }
    for (const block of pendingInputBlocks) prepared.push(block);
    if (prepared.length === 0) return false;
    const completed = await submitInput(prepared);
    if (completed) dispatchComposer({ kind: "clearPendingInput" });
    return completed;
  });
  const submitVoiceTranscript = useEvent(async (text: string): Promise<boolean> => {
    let input: V2InputBlock[];
    try {
      input = await attachmentDraft.prepareInput(text, attachmentTarget);
    } catch (cause: unknown) {
      setComposerError(errorMessage(cause, "Could not prepare attachments."));
      return false;
    }
    for (const block of pendingInputBlocks) input.push(block);
    const completed = await submitInput(input);
    if (completed) {
      dispatchComposer({ kind: "clearPendingInput" });
      attachmentDraft.commit();
    }
    return completed;
  });
  const voice = useVoiceInputControl({
    audience: owner.savedServerId,
    live: threadLive,
    onSubmitTranscript: submitVoiceTranscript,
    onTranscript: addTranscript,
    projection: snapshot.value.projections.live,
    scope: { id: owner.threadId, kind: "composer" },
    thread: owner,
  });
  const searchVoice = useVoiceInputControl({
    audience: owner.savedServerId,
    live: threadLive,
    onTranscript: changeSearchQuery,
    projection: snapshot.value.projections.live,
    scope: { id: `thread-search:${owner.threadId}`, kind: "generic" },
    thread: owner,
  });
  const voiceLevel = useVoiceInputLevel(owner.savedServerId, {
    id: owner.threadId,
    kind: "composer",
  });
  const openPriorTurnEditor = useEvent((request: EditPriorTurnReady) => {
    const text = request.draftInput
      .flatMap((block) => (block.kind === "text" ? [block.text] : []))
      .join("\n");
    dispatchComposer({
      blocks: request.draftInput.filter((block) => block.kind !== "text"),
      kind: "editPriorTurn",
      text,
    });
    runtime.composerAttachments.setText(composerDraftScope, text);
  });
  const openResponseReview = useEvent((request: ResponseReviewNavigation) => {
    router.push(reviewResponseDestination(request.owner, request.turnId, request.itemId));
  });
  const openAccounts = useEvent(() => {
    router.push(accountSettingsDestination(owner.savedServerId));
  });
  const turnActions = createTurnActions({
    commands: runtime.commandActivations,
    owner,
    presentation: { openPriorTurnEditor, openResponseReview },
  });
  const interruptActiveTurn = useEvent(async (turnId: string): Promise<void> => {
    await turnActions.interruptTurn(turnId);
  });
  const actionsForTurn = (turn: TimelineDisplayTurn): TimelineTurnActions | undefined => {
    if (!threadLive) return undefined;
    const index = timelineTurns.findIndex((candidate) => candidate.id === turn.id);
    if (index < 0) return undefined;
    const source = history.snapshot.turns.find((candidate) => candidate.id === turn.id);
    if (source === undefined) return undefined;
    const availability = turnActionAvailability({
      hasAssistantResponse: turn.assistantItemId !== undefined,
      hasRollbackBoundary: true,
      state: turn.state,
    });
    const assistantItemId = turn.assistantItemId;
    const draftInput = turnInputBlocks(source, threadAttachments);
    return {
      ...(draftInput === null || draftInput.length === 0
        ? {}
        : {
            onEdit: async () =>
              turnActions.editPriorTurn({
                draftInput,
                rollbackThroughTurnId: timelineTurns[index - 1]?.id ?? null,
                sourceTurnId: turn.id,
              }),
          }),
      ...(availability.canFork
        ? {
            onFork: async () => {
              const result = await turnActions.forkThroughTurn(turn.id);
              router.push(
                threadDestination(qualifiedThread(owner.savedServerId, threadId(result.thread.id))),
              );
            },
          }
        : {}),
      ...(availability.canInterrupt
        ? { onInterrupt: async () => void (await turnActions.interruptTurn(turn.id)) }
        : {}),
      ...(availability.canReview && assistantItemId !== undefined
        ? {
            onReview: async () =>
              turnActions.reviewResponse({ itemId: assistantItemId, turnId: turn.id }),
          }
        : {}),
      ...(availability.canRollback
        ? { onRollback: async () => void (await turnActions.rollbackThroughTurn(turn.id)) }
        : {}),
    };
  };
  const subtitle =
    snapshot.value.state === "live"
      ? conversationSubtitle(
          servers.value.find((value) => {
            const { id } = value;
            return id === owner.savedServerId;
          })?.displayName ?? "",
          window?.thread.workspace ?? "",
        )
      : "connecting…";
  const title =
    window?.thread.title ?? firstPreviewLine(window?.thread.preview ?? "") ?? "Conversation";
  return {
    accounts: accountUsagePresentation(accountsSnapshot.value, runtime.now()),
    activityActions,
    actionsForTurn,
    activeTurnId,
    archived: window?.thread.archived === true,
    attachmentDraft,
    attachmentTarget,
    canLoadNewer: !searchActive && history.snapshot.canLoadNewer,
    canLoadOlder: !searchActive && history.snapshot.canLoadOlder,
    clearVersion,
    composerError,
    composerText,
    contextItems,
    contextUsage: usage.context,
    deliveryMode,
    desktop: isDesktopWindow({ height, width }),
    draftId,
    drawingNow,
    drawingRequest,
    goalVisible,
    initialAnchorTurnId: searchActive ? search.selectedTurnId : initialHistoryRestore.turnId,
    initialAnchorOffsetPx: searchActive ? 0 : initialHistoryRestore.viewportOffsetPx,
    latestActivityMarker: searchActive ? null : unreadMarker,
    authorityError:
      requestedThread.threadId === owner.threadId && requestedThread.status === "error"
        ? requestedThread.message
        : null,
    live: threadLive,
    livePlan,
    locallyLocked,
    onBack,
    onCloseDrawing: closeDrawing,
    onCloseGoal: closeGoal,
    onCloseResourceMenu: closeResourceMenu,
    onCloseSkills: closeSkills,
    onComposerError: setComposerError,
    onDrawingAttached: completeDrawing,
    onEditAttachment: editDrawing,
    onEditComposer: editComposer,
    onJumpToLatest: jumpToLatest,
    onHistoryAnchorChange: changeHistoryAnchor,
    onInterruptActiveTurn: interruptActiveTurn,
    onLatestFinalAssistantVisible: markLatestVisibleRead,
    onLoadActivity: loadActivity,
    onLoadNewer: loadNewer,
    onLoadOlder: loadOlder,
    onOpenContext: openContext,
    onOpenAccounts: openAccounts,
    onRetryAuthority: retryThreadAuthority,
    onReleaseUnsettled: releaseUnsettled,
    onSelectComposerAction: selectComposerAction,
    onSelectDeliveryMode: setDeliveryPreference,
    onSelectResource: selectResource,
    onSelectSkill: selectSkill,
    onSettleWindow: settleHistoryWindow,
    onSubmitMessage: submitComposer,
    onTextChange: setComposerText,
    owner,
    pendingRequests: projection?.pendingRequests ?? [],
    readReceiptRetryKey: threadLive ? (snapshot.value.projections.live?.epochId ?? null) : null,
    renderingCapabilities,
    reviewAvailable,
    refreshing: refreshState.status === "refreshing",
    resourceMenuVisible,
    retryBlocked: terminalBlocked,
    search: {
      canMoveNewer: search.canMoveNewer,
      canMoveOlder: search.canMoveOlder,
      error: search.phase.kind === "error" ? search.phase.message : null,
      loading: search.phase.kind === "loading",
      matchCount: search.matchCount,
      onChangeQuery: changeSearchQuery,
      onClose: closeSearch,
      onMoveNewer: moveSearchNewer,
      onMoveOlder: moveSearchOlder,
      onToggle: toggleSearch,
      query: search.query,
      voice: searchVoice,
      visible: searchVisible,
    },
    sessionUsage: usage.session,
    skillsVisible,
    subtitle,
    title,
    timelineIdentity: searchActive
      ? `${owner.savedServerId}:${owner.threadId}:search:${search.query}:${search.selectedTurnId ?? "none"}`
      : `${owner.savedServerId}:${owner.threadId}:live:${historyRestoreIdentity}`,
    turns: visibleTimelineTurns,
    unreadCount: searchActive ? 0 : (window?.thread.readState?.unreadCount ?? 0),
    unsettledCount,
    unsettledBlockingCount,
    usageBreakdown: usage.breakdown,
    voice,
    voiceLevel,
    voiceNowMs: runtime.now(),
    workspace: window?.thread.workspace ?? "",
  };
}

function useTurnActivityLoader(
  runtime: V2Runtime,
  owner: QualifiedThread,
): (turnId: string) => Promise<TimelineDisplayResponseRow[]> {
  return useEvent(async (turnId: string): Promise<TimelineDisplayResponseRow[]> => {
    const items: V2Item[] = [];
    let cursor: string | null = null;
    do {
      const result = await runtime.queries.execute(owner.savedServerId, {
        cursor,
        kind: "turn.items",
        limit: 100,
        threadId: owner.threadId,
        turnId,
      });
      if (result.kind !== "turn.items") throw new Error("Turn items query returned wrong result");
      items.push(...result.items);
      if (result.next !== null && result.next === cursor)
        throw new Error("Turn items query returned repeated cursor");
      cursor = result.next;
    } while (cursor !== null);
    return timelineResponseRowsDisplayModel(items);
  });
}

interface ConversationSurfaceProps {
  accounts: readonly UsageAccountViewModel[];
  activityActions: TimelineActivityActions;
  actionsForTurn(turn: TimelineDisplayTurn): TimelineTurnActions | undefined;
  activeTurnId: string | null;
  authorityError: string | null;
  archived: boolean;
  attachmentDraft: ComposerAttachmentDraft;
  attachmentTarget: ComposerAttachmentTarget;
  canLoadNewer: boolean;
  canLoadOlder: boolean;
  clearVersion: number;
  composerError: string | null;
  composerText: string;
  contextItems: ComposerContextItem[];
  contextUsage: UsageContextViewModel | null;
  deliveryMode: QueueDeliveryMode;
  desktop: boolean;
  draftId: string;
  drawingNow(): Date;
  drawingRequest: DrawingWorkspaceRequest | null;
  goalVisible: boolean;
  initialAnchorOffsetPx: number | null;
  initialAnchorTurnId: string | null;
  latestActivityMarker: string | null;
  live: boolean;
  livePlan: LiveTurnPlanViewModel | null;
  locallyLocked: boolean;
  onBack(): void;
  onCloseResourceMenu(): void;
  onCloseDrawing(): void;
  onCloseGoal(): void;
  onCloseSkills(): void;
  onComposerError(message: string | null): void;
  onDrawingAttached(draftItemId: string): void;
  onEditAttachment(item: ComposerAttachmentDraftItem): void;
  onEditComposer(): void;
  onOpenContext(id: string): void;
  onOpenAccounts(): void;
  onRetryAuthority(): Promise<void>;
  onReleaseUnsettled(): Promise<void>;
  onLoadNewer(): Promise<void>;
  onLoadOlder(): Promise<void>;
  onLoadActivity(turnId: string): Promise<TimelineDisplayResponseRow[]>;
  onJumpToLatest(): string | null;
  onHistoryAnchorChange(turnId: string | null, viewportOffsetPx: number | null): void;
  onInterruptActiveTurn(turnId: string): Promise<void>;
  onLatestFinalAssistantVisible(marker: string): Promise<void>;
  onSelectComposerAction(id: string): void;
  onSelectDeliveryMode(mode: QueueDeliveryMode): void;
  onSelectResource(id: string): void;
  onSelectSkill(skill: SkillCatalogEntry): void;
  onSubmitMessage(submission: ComposerSubmission): Promise<boolean>;
  onSettleWindow(direction: "newer" | "older"): void;
  onTextChange(text: string): void;
  owner: QualifiedThread;
  pendingRequests: readonly V2PendingRequest[];
  readReceiptRetryKey: string | null;
  renderingCapabilities: V2RenderingCapabilities;
  reviewAvailable: boolean;
  refreshing: boolean;
  resourceMenuVisible: boolean;
  retryBlocked: boolean;
  search: ConversationSearchModel;
  sessionUsage: UsageSessionViewModel | null;
  skillsVisible: boolean;
  subtitle: string;
  title: string;
  timelineIdentity: string;
  turns: TimelineDisplayTurn[];
  unreadCount: number;
  unsettledCount: number;
  unsettledBlockingCount: number;
  usageBreakdown: UsageBreakdownViewModel | null;
  voice: VoiceInputControlModel;
  voiceLevel: number;
  voiceNowMs: number;
  workspace: string;
}

interface ConversationSearchModel {
  canMoveNewer: boolean;
  canMoveOlder: boolean;
  error: string | null;
  loading: boolean;
  matchCount: number;
  onChangeQuery(query: string): void;
  onClose(): void;
  onMoveNewer(): void;
  onMoveOlder(): void;
  onToggle(): void;
  query: string;
  voice: VoiceInputControlModel;
  visible: boolean;
}

function ConversationSurface(props: ConversationSurfaceProps): React.JSX.Element {
  const {
    accounts,
    activityActions,
    actionsForTurn,
    activeTurnId,
    authorityError,
    archived,
    attachmentDraft,
    attachmentTarget,
    canLoadNewer,
    canLoadOlder,
    clearVersion,
    composerError,
    composerText,
    contextItems,
    contextUsage,
    deliveryMode,
    desktop,
    draftId,
    drawingNow,
    drawingRequest,
    goalVisible,
    initialAnchorOffsetPx,
    initialAnchorTurnId,
    latestActivityMarker,
    live,
    livePlan,
    locallyLocked,
    onBack,
    onCloseResourceMenu,
    onCloseDrawing,
    onCloseGoal,
    onCloseSkills,
    onComposerError,
    onDrawingAttached,
    onEditAttachment,
    onEditComposer,
    onOpenContext,
    onOpenAccounts,
    onRetryAuthority,
    onReleaseUnsettled,
    onLoadNewer,
    onLoadOlder,
    onLoadActivity,
    onJumpToLatest,
    onHistoryAnchorChange,
    onInterruptActiveTurn,
    onLatestFinalAssistantVisible,
    onSelectComposerAction,
    onSelectDeliveryMode,
    onSelectResource,
    onSelectSkill,
    onSubmitMessage,
    onSettleWindow,
    onTextChange,
    owner,
    pendingRequests,
    readReceiptRetryKey,
    renderingCapabilities,
    reviewAvailable,
    refreshing,
    resourceMenuVisible,
    retryBlocked,
    search,
    sessionUsage,
    skillsVisible,
    subtitle,
    title,
    timelineIdentity,
    turns,
    unreadCount,
    unsettledCount,
    unsettledBlockingCount,
    usageBreakdown,
    voice,
    voiceLevel,
    voiceNowMs,
    workspace,
  } = props;
  return (
    <WorkspaceView
      subtitle={<WorkspaceSubtitleView text={subtitle} updating={refreshing} />}
      leading={
        desktop ? undefined : (
          <TopBarActionView icon="back" label="Back to threads" onPress={onBack} />
        )
      }
      actions={
        <>
          <TopBarActionView
            active={search.visible}
            icon="search"
            label="Search in thread"
            onPress={search.onToggle}
          />
          <UsagePopoverView
            accounts={accounts}
            actions={[
              {
                description: "Profiles and usage limits",
                icon: "people",
                id: "accounts",
                label: "Manage accounts",
                onPress: onOpenAccounts,
              },
            ]}
            align="end"
            context={contextUsage}
            placement="bottom"
            session={sessionUsage}
            triggerAccessibilityLabel="Context usage and account limits"
            triggerStyle={contextRingActionStyle}
          >
            <ContextRingView percent={contextUsage?.percent ?? 0} />
          </UsagePopoverView>
          <ConversationThreadMenu
            archived={archived}
            live={live}
            onBack={onBack}
            onError={onComposerError}
            owner={owner}
            title={title}
          />
        </>
      }
      title={title}
    >
      <MessageActionProviderView>
        <ConversationView>
          <ConversationSearchBar search={search} />
          <V2RenderingCapabilityProvider capabilities={renderingCapabilities}>
            <TimelineView
              key={timelineIdentity}
              activityActions={activityActions}
              actionsForTurn={actionsForTurn}
              canLoadNewer={canLoadNewer}
              canLoadOlder={canLoadOlder}
              initialAnchorOffsetPx={initialAnchorOffsetPx}
              latestActivityMarker={latestActivityMarker}
              initialAnchorTurnId={initialAnchorTurnId}
              onLoadNewer={onLoadNewer}
              onLoadOlder={onLoadOlder}
              onLoadActivity={onLoadActivity}
              onJumpToLatest={onJumpToLatest}
              onAnchorTurnChange={onHistoryAnchorChange}
              onLatestFinalAssistantVisible={onLatestFinalAssistantVisible}
              readReceiptRetryKey={readReceiptRetryKey}
              onSettleWindow={onSettleWindow}
              timelineKey={timelineIdentity}
              turns={turns}
              unreadCount={unreadCount}
            />
          </V2RenderingCapabilityProvider>
          <PendingRequestsPanel
            enabled={live}
            {...(renderingCapabilities.openExternalLink === undefined
              ? {}
              : { openExternalLink: renderingCapabilities.openExternalLink })}
            pendingRequests={pendingRequests}
            savedServerId={owner.savedServerId}
            threadId={owner.threadId}
          />
          <ConversationComposerDockView>
            {authorityError === null ? null : (
              <View style={styles.authorityFailure}>
                <ProductText accessibilityRole="alert" tone="warning">
                  {authorityError}
                </ProductText>
                <ActionPressable
                  action={{
                    id: `retry-thread-authority:${owner.savedServerId}:${owner.threadId}`,
                    label: "Retry conversation",
                    run: onRetryAuthority,
                  }}
                />
              </View>
            )}
            <QueueControlsFeature
              activeTurnId={activeTurnId}
              mutationsEnabled={live}
              savedServerId={owner.savedServerId}
              threadId={owner.threadId}
            />
            {unsettledCount === 0 ? null : (
              <>
                <ProductText accessibilityLiveRegion="polite" tone="warning">
                  {unsettledCount} saved message{unsettledCount === 1 ? " is" : "s are"} waiting for
                  the server
                </ProductText>
                {unsettledBlockingCount === 0 ? null : (
                  <ActionPressable
                    action={{
                      id: `release-unsettled:${owner.savedServerId}:${owner.threadId}`,
                      label: "Send another anyway",
                      run: onReleaseUnsettled,
                    }}
                  />
                )}
              </>
            )}
            {!reviewAvailable && livePlan === null && usageBreakdown === null ? null : (
              <View style={styles.liveStatus}>
                {reviewAvailable ? <StartReviewLaunchButton owner={owner} /> : null}
                {livePlan === null ? null : <LiveTurnPlanPopover plan={livePlan} />}
                {usageBreakdown === null ? null : (
                  <CostBreakdownPopover breakdown={usageBreakdown} />
                )}
              </View>
            )}
            <DeliveryModeSelectorView
              activeTurnId={activeTurnId}
              disabled={!live || locallyLocked}
              onSelect={onSelectDeliveryMode}
              selected={deliveryMode}
              threadRunning={activeTurnId !== null}
            />
            <ComposerContextStripView items={contextItems} onOpen={onOpenContext} />
            <V2ChatComposer
              activeTurnId={activeTurnId}
              key={clearVersion}
              disabled={!live}
              draftId={draftId}
              error={composerError}
              locked={locallyLocked}
              menuActions={COMPOSER_ACTIONS}
              onEdit={onEditComposer}
              onEditAttachment={onEditAttachment}
              onInterrupt={onInterruptActiveTurn}
              onSelectMenu={onSelectComposerAction}
              onSubmit={onSubmitMessage}
              retryBlocked={retryBlocked}
              onTextChange={onTextChange}
              savedServerId={owner.savedServerId}
              target={attachmentTarget}
              text={composerText}
              voice={voice}
              voiceLevel={voiceLevel}
              voiceNowMs={voiceNowMs}
            />
          </ConversationComposerDockView>
          <ActionSheetView
            items={RESOURCE_ACTIONS}
            onClose={onCloseResourceMenu}
            onSelect={onSelectResource}
            title="Thread"
            visible={resourceMenuVisible}
          />
          {goalVisible ? (
            <ThreadGoalSheet
              onClose={onCloseGoal}
              savedServerId={owner.savedServerId}
              threadId={owner.threadId}
            />
          ) : null}
          {skillsVisible ? (
            <SkillsSheet
              onClose={onCloseSkills}
              onSelect={onSelectSkill}
              savedServerId={owner.savedServerId}
              workspace={workspace}
            />
          ) : null}
          {drawingRequest === null ? null : (
            <DrawingWorkspace
              draft={attachmentDraft}
              draftItemId={drawingRequest.draftItemId}
              initialSnapshot={drawingRequest.initialSnapshot}
              mode={drawingRequest.mode}
              {...(drawingRequest.name === undefined ? {} : { name: drawingRequest.name })}
              now={drawingNow}
              onAttached={onDrawingAttached}
              onClose={onCloseDrawing}
            />
          )}
        </ConversationView>
      </MessageActionProviderView>
    </WorkspaceView>
  );
}

interface ConversationSearchBarProps {
  search: ConversationSearchModel;
}

function ConversationSearchBar(props: ConversationSearchBarProps): React.JSX.Element | null {
  const { search } = props;
  if (!search.visible) return null;
  return (
    <ConversationSearchView
      canMoveNewer={search.canMoveNewer}
      canMoveOlder={search.canMoveOlder}
      error={search.error}
      loading={search.loading}
      matchCount={search.matchCount}
      onChangeText={search.onChangeQuery}
      onClose={search.onClose}
      onMoveNewer={search.onMoveNewer}
      onMoveOlder={search.onMoveOlder}
      query={search.query}
      voice={search.voice}
    />
  );
}

function firstPreviewLine(value: string): string | null {
  const line = value
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ?? null;
}

function conversationSubtitle(serverName: string, workspace: string): string {
  const normalized = workspace.replace(/[\\/]+$/u, "");
  const candidate = normalized.split(/[\\/]/u).at(-1);
  const project = candidate === undefined || candidate === "" ? "workspace" : candidate;
  const server = serverName.trim();
  return server === "" ? project : `${server} · ${project}`;
}

function useThreadControlChips(input: ThreadControlChipsInput): ComposerContextItem[] {
  const {
    actionable,
    agentCount,
    modelsSnapshot,
    owner,
    portCount,
    resourcesResult,
    runtime,
    setError,
    settings,
    terminalItem,
    threadWindow,
  } = input;
  const [settingsPending, startSettingsUpdate] = useTransition();
  const updateThreadSettings = useEvent((next: V2ThreadSettings) => {
    if (!actionable) {
      setError("Conversation is still connecting.");
      return;
    }
    if (settingsPending) return;
    setError(null);
    startSettingsUpdate(() =>
      runtime.commandActivations
        .execute(owner.savedServerId, threadSettingsUpdateCommand(owner, next))
        .then(
          (frame) => {
            if (frame.type !== "commandCompleted") setError(frame.error.message);
          },
          (cause: unknown) => {
            setError(cause instanceof Error ? cause.message : "Could not update thread settings.");
          },
        ),
    );
  });
  const selectModel = useEvent((id: string) => {
    const next = nextModelSettings(id, settings, modelsSnapshot.value);
    if (next === null) {
      setError("Model settings are unavailable.");
      return;
    }
    updateThreadSettings(next);
  });
  const selectPermissions = useEvent((id: string) => {
    const next = nextConversationPermissionSettings(id, settings);
    if (next === null) {
      setError("Permission settings are unavailable.");
      return;
    }
    updateThreadSettings(next);
  });
  return composerContextItems({
    actionable,
    agentCount,
    modelsError: modelsSnapshot.status === "error" ? modelsSnapshot.message : null,
    modelsLoading: modelsSnapshot.status === "loading",
    modelsResult: modelsSnapshot.value,
    onSelectModel: selectModel,
    onSelectPermissions: selectPermissions,
    portCount,
    resourcesResult,
    settingsPending,
    terminalItem,
    threadWindow,
  });
}

function composerContextItems(input: ComposerContextItemsInput): ComposerContextItem[] {
  const {
    actionable,
    agentCount,
    modelsError,
    modelsLoading,
    modelsResult,
    onSelectModel,
    onSelectPermissions,
    portCount,
    resourcesResult,
    settingsPending,
    terminalItem,
    threadWindow,
  } = input;
  const settings = threadWindow?.thread.settings ?? null;
  const models = modelsResult?.kind === "models.list" ? modelsResult.models : [];
  const selectedModel = models.find((value) => {
    const { id } = value;
    return id === settings?.model;
  });
  const model = selectedModel?.label ?? settings?.model ?? "Model";
  const effort = settings?.effort ?? selectedModel?.defaultEffort ?? "default";
  const changes = resourcesResult?.kind === "thread.resources" ? resourcesResult.changes : null;
  const attachments =
    resourcesResult?.kind === "thread.resources" ? resourcesResult.attachments : null;
  const items: ComposerContextItem[] = [
    {
      icon: "sparkles",
      id: "model",
      label: `${model} · ${effort}`,
      loading: modelsLoading || settingsPending,
      menu: {
        accessibilityLabel: `Model and thinking: ${model}, ${effort}`,
        actions: modelMenuActions(models, settings, modelsLoading, modelsError, actionable).map(
          (action) => (settingsPending ? { ...action, disabled: true } : action),
        ),
        menuWidth: 344,
        onSelect: onSelectModel,
      },
    },
  ];
  items.push(
    conversationPermissionContextItem({
      actionable,
      onSelect: onSelectPermissions,
      pending: settingsPending,
      settings,
    }),
  );
  if (changes !== null && changes.length > 0) {
    items.push({ icon: "changes", id: "changes", label: `Changes · ${changes.length}` });
  }
  if (attachments !== null && attachments.length > 0) {
    items.push({
      icon: "attach",
      id: "attachments",
      label: `Attachments · ${attachments.length}`,
    });
  }
  if (portCount > 0) items.push({ icon: "ports", id: "ports", label: `Ports: ${portCount}` });
  if (agentCount > 0)
    items.push({ icon: "construct", id: "agents", label: `Subagents: ${agentCount}` });
  if (terminalItem !== null) items.push(terminalItem);
  return items;
}

function modelMenuActions(
  models: ModelsResult["models"],
  settings: V2ThreadSettings | null,
  loading: boolean,
  error: string | null,
  actionable: boolean,
): ActionMenuItem[] {
  const selected = models.find((model) => model.id === settings?.model) ?? models[0];
  const efforts = selected === undefined ? [] : availableEfforts(selected);
  const unavailable = settings === null || !actionable;
  return [
    ...(loading && models.length === 0
      ? [
          {
            disabled: true,
            id: "model:loading",
            label: "Loading from remote server…",
            section: "Model",
          },
        ]
      : []),
    ...(error === null
      ? []
      : [{ destructive: true, disabled: true, id: "model:error", label: error, section: "Error" }]),
    ...(models.length === 0 && !loading
      ? [
          {
            disabled: true,
            id: "model:empty",
            label: "No models returned by the server",
            section: "Model",
          },
        ]
      : models.map((model) => ({
          disabled: unavailable,
          id: `model:${model.id}`,
          label: model.label,
          section: "Model",
          selected: model.id === settings?.model,
        }))),
    ...efforts.map((effort) => ({
      disabled: unavailable,
      id: `effort:${effort}`,
      keepOpen: selected?.supportsPersonality === true,
      label: thinkingEffortLabel(effort),
      section: "Thinking level",
      selected: effort === settings?.effort,
    })),
    ...(selected?.supportsPersonality === true
      ? [
          {
            disabled: unavailable,
            id: "personality:default",
            keepOpen: true,
            label: "Server default",
            section: "Personality",
            selected: settings?.personality === null,
          },
          ...(["friendly", "pragmatic", "none"] as const).map((personality) => ({
            disabled: unavailable,
            id: `personality:${personality}`,
            keepOpen: true,
            label: personalityLabel(personality),
            section: "Personality",
            selected: personality === settings?.personality,
          })),
        ]
      : []),
  ];
}

function nextModelSettings(
  id: string,
  settings: V2ThreadSettings | null,
  result: V2QueryResult | null,
): V2ThreadSettings | null {
  if (settings === null || result?.kind !== "models.list") return null;
  if (id.startsWith("model:")) {
    const model = result.models.find((candidate) => candidate.id === id.slice("model:".length));
    if (model === undefined) return null;
    return {
      ...settings,
      effort: compatibleEffort(model, settings.effort),
      model: model.id,
      personality: model.supportsPersonality ? settings.personality : null,
    };
  }
  if (id.startsWith("personality:")) {
    const model = result.models.find((candidate) => candidate.id === settings.model);
    if (model?.supportsPersonality !== true) return null;
    const value = id.slice("personality:".length);
    const personality =
      value === "friendly" || value === "pragmatic" || value === "none" ? value : null;
    if (value !== "default" && personality === null) return null;
    return { ...settings, personality };
  }
  if (!id.startsWith("effort:") || settings.model === null) return null;
  const effort = id.slice("effort:".length);
  const model = result.models.find((candidate) => candidate.id === settings.model);
  if (model === undefined || !isThreadEffort(effort) || !availableEfforts(model).includes(effort))
    return null;
  return { ...settings, effort };
}

function compatibleEffort(
  model: ModelsResult["models"][number],
  current: V2ThreadSettings["effort"],
): V2ThreadSettings["effort"] {
  const efforts = availableEfforts(model);
  if (current !== null && efforts.includes(current)) return current;
  if (isThreadEffort(model.defaultEffort) && efforts.includes(model.defaultEffort)) {
    return model.defaultEffort;
  }
  return efforts[0] ?? null;
}

function availableEfforts(model: ModelsResult["models"][number]): ThreadEffort[] {
  if (model.efforts.length > 0) return model.efforts;
  return isThreadEffort(model.defaultEffort) ? [model.defaultEffort] : [];
}

function isThreadEffort(value: string | null): value is ThreadEffort {
  return value !== null && THREAD_EFFORTS.has(value);
}

function thinkingEffortLabel(effort: ThreadEffort): string {
  const explicit = THREAD_EFFORT_LABELS[effort];
  if (explicit !== undefined) return explicit;
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function personalityLabel(personality: NonNullable<V2ThreadSettings["personality"]>): string {
  return `${personality.charAt(0).toUpperCase()}${personality.slice(1)}`;
}

const THREAD_EFFORTS = new Set<string>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const THREAD_EFFORT_LABELS: Readonly<Record<string, string>> = {
  max: "Maximum",
  xhigh: "Extra high",
};

function isThreadResourceName(value: string): value is ThreadResourceName {
  return (
    value === "agents" || value === "attachments" || value === "changes" || value === "terminal"
  );
}

function historyRestore(state: ComposerDraftLocalState): InitialHistoryRestore {
  const cursor =
    state.historyGenerationId === null ||
    state.historyPageCursor === null ||
    state.historyPageDirection === null
      ? null
      : {
          cursor: state.historyPageCursor,
          direction: state.historyPageDirection,
          generationId: state.historyGenerationId,
        };
  return {
    cursor,
    turnId: state.historyAnchorTurnId,
    viewportOffsetPx: state.historyAnchorOffsetPx,
  };
}

function completedComposerCommand(
  frame: V2CommandTerminalFrame,
  expectedThreadId: string,
): boolean {
  if (frame.type !== "commandCompleted") return false;
  const { result } = frame;
  if (result.kind === "turn.submit" || result.kind === "turn.steer") {
    return result.threadId === expectedThreadId;
  }
  if (result.kind !== "queue.mutate") return false;
  if (result.outcome.kind === "item") return result.outcome.item.threadId === expectedThreadId;
  return result.outcome.kind === "steered" && result.outcome.threadId === expectedThreadId;
}

function latestActiveTurnId(turns: V2ThreadWindow["turns"]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.state === "running" || turn?.state === "queued") return turn.id;
  }
  return null;
}

function effectiveDeliveryMode(
  preference: QueueDeliveryMode,
  threadRunning: boolean,
  activeTurnId: string | null,
): QueueDeliveryMode {
  if (!threadRunning) return "sendNow";
  if (preference === "steer" && activeTurnId !== null) return "steer";
  return "queue";
}

function turnInputBlocks(
  turn: V2ThreadWindow["turns"][number],
  attachments: readonly V2Attachment[],
): V2InputBlock[] | null {
  const input: V2InputBlock[] = [];
  for (const item of turn.items) {
    if (item.kind !== "userMessage") continue;
    for (const block of item.content) {
      if (block.kind === "text") {
        input.push({ kind: "text", text: block.text });
        continue;
      }
      if (block.kind === "skill") {
        input.push({ kind: "skill", name: block.name, path: block.path });
        continue;
      }
      if (block.kind === "mention" && /^[a-z][a-z0-9+.-]*:\/\//iu.test(block.path)) return null;
      const reference = block.kind === "image" || block.kind === "audio" ? block.url : block.path;
      const attachment = attachmentForReference(attachments, reference);
      if (attachment === null) return null;
      input.push({ attachmentId: attachment.id, kind: "attachment" });
    }
  }
  return input;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function conversationComposerReducer(
  state: ConversationComposerState,
  action: ConversationComposerAction,
): ConversationComposerState {
  if (action.kind === "addTranscript") {
    return {
      ...state,
      text: state.text.trim() === "" ? action.text : `${state.text.trimEnd()} ${action.text}`,
    };
  }
  if (action.kind === "clearPendingInput") return { ...state, pendingInputBlocks: [] };
  if (action.kind === "edit") return { ...state, error: null, terminalBlocked: false };
  if (action.kind === "editPriorTurn") {
    return {
      ...state,
      error: null,
      pendingInputBlocks: action.blocks,
      terminalBlocked: false,
      text: action.text,
    };
  }
  if (action.kind === "lock") {
    return {
      ...state,
      error: action.message,
      lockedActivation: action.activation,
    };
  }
  if (action.kind === "releaseUnsettled") {
    return { ...state, error: null, lockedActivation: null };
  }
  if (action.kind === "selectSkill") {
    const pendingInputBlocks = state.pendingInputBlocks.filter(
      (block) =>
        block.kind !== "skill" || action.block.kind !== "skill" || block.path !== action.block.path,
    );
    pendingInputBlocks.push(action.block);
    return { ...state, pendingInputBlocks, text: action.text };
  }
  if (action.kind === "setError") return { ...state, error: action.message };
  if (action.kind === "setText") return { ...state, text: action.text };
  if (action.kind === "settled") {
    return {
      ...state,
      clearVersion: state.clearVersion + 1,
      error: null,
      lockedActivation: null,
      pendingInputBlocks: [],
      terminalBlocked: false,
      text: "",
    };
  }
  if (action.kind === "submitCompleted") {
    return { ...state, error: null, terminalBlocked: false };
  }
  if (action.kind === "terminalFailure") {
    return {
      ...state,
      error: action.message,
      lockedActivation: null,
      terminalBlocked: true,
    };
  }
  return {
    ...state,
    error: action.message,
    lockedActivation: null,
    terminalBlocked: false,
  };
}

function composerTerminalMessage(frame: V2CommandTerminalFrame): string {
  if (frame.type === "commandIndeterminate") {
    return "The saved message outcome is unknown. Edit the draft before sending again.";
  }
  if (frame.type === "commandExpired") {
    return "The saved message expired. Edit the draft before sending again.";
  }
  if (frame.type === "commandFailed") {
    return "The server rejected the saved message. Edit the draft before sending again.";
  }
  return "The saved action completed without this message. Edit the draft before sending again.";
}

const styles = StyleSheet.create({
  authorityFailure: { gap: spacing.xs },
  liveStatus: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
