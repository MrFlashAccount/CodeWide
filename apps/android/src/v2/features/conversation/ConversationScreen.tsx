import type {
  V2CommandTerminalFrame,
  V2Item,
  V2Query,
  V2QueryResult,
  V2ThreadSettings,
  V2ThreadWindow,
} from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore, useTransition } from "react";
import { useWindowDimensions } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { ActionSheetView, type ActionSheetItem } from "../../presentation/actions/ActionSheetView";
import { TopBarActionView } from "../../presentation/actions/TopBarActionView";
import { ShimmerText } from "../../presentation/text/ShimmerText";
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
import { ThreadHistoryResource } from "../../application/resources/threadHistoryResource";
import type { V2Runtime } from "../../application/v2Runtime";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { ConversationView } from "../../presentation/conversation/ConversationView";
import { ConversationSearchView } from "../../presentation/conversation/ConversationSearchView";
import {
  ContextRingView,
  contextRingActionStyle,
} from "../../presentation/conversation/ContextRingActionView";
import {
  TimelineView,
  type TimelineDisplayActivity,
  type TimelineDisplayTurn,
} from "../../presentation/conversation/TimelineView";
import {
  ComposerContextStripView,
  type ComposerContextItem,
} from "../../presentation/input/ComposerContextStripView";
import { ProductText } from "../../presentation/text/ProductText";
import { isDesktopWindow } from "../../presentation/layouts/windowLayout";
import { ChatComposer } from "../composer/ChatComposer";
import { useVoiceInputControl, type VoiceInputControlModel } from "./VoiceInputControl";
import { ConversationThreadMenu } from "./ConversationThreadMenu";
import { activityDisplayModel, timelineTurnsDisplayModel } from "./timelineDisplayModel";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";

type ThreadResourceName = "agents" | "attachments" | "changes" | "terminal";
type ModelsResult = Extract<V2QueryResult, { kind: "models.list" }>;
type ThreadEffort = NonNullable<V2ThreadSettings["effort"]>;

interface ComposerContextItemsInput {
  agentCount: number;
  modelsError: string | null;
  modelsLoading: boolean;
  modelsResult: V2QueryResult | null;
  onSelectModel(id: string): void;
  onSelectPermissions(id: string): void;
  portCount: number;
  resourcesResult: V2QueryResult | null;
  settingsPending: boolean;
  threadWindow: V2ThreadWindow | null;
}

interface ThreadControlChipsInput {
  agentCount: number;
  modelsSnapshot: ResourceSnapshot<V2QueryResult | null>;
  owner: QualifiedThread;
  portCount: number;
  resourcesResult: V2QueryResult | null;
  runtime: V2Runtime;
  setError(message: string | null): void;
  settings: V2ThreadSettings | null;
  threadWindow: V2ThreadWindow | null;
}

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
  if (opened.value === null) {
    return (
      <WorkspaceView title="Conversation">
        <ShimmerText text="Opening conversation…" />
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
  const { onBack, onOpenPorts, onOpenResource, owner, resource } = props;
  const runtime = useV2Runtime();
  const { height, width } = useWindowDimensions();
  const [ports] = useState(() => runtime.ports(owner.savedServerId));
  const portsSnapshot = useSyncExternalStore(ports.subscribe, ports.snapshot, ports.snapshot);
  const servers = useSyncExternalStore(
    runtime.savedServers.subscribe,
    runtime.savedServers.snapshot,
    runtime.savedServers.snapshot,
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const accountsSnapshot = useLiveQuery(runtime, owner.savedServerId, ACCOUNTS_QUERY);
  const modelsSnapshot = useLiveQuery(runtime, owner.savedServerId, MODELS_QUERY);
  const threadResourcesSnapshot = useLiveQuery(runtime, owner.savedServerId, {
    kind: "thread.resources",
    scope: "session",
    threadId: owner.threadId,
  });
  const projection = snapshot.value.projections.live ?? snapshot.value.projections.retained;
  const window =
    projection?.currentThread?.thread.id === owner.threadId ? projection.currentThread : null;
  const executeHistoryQuery = useEvent(async (query: V2Query): Promise<V2QueryResult> =>
    runtime.queries.execute(owner.savedServerId, query),
  );
  const [historyResource] = useState(
    () =>
      new ThreadHistoryResource({
        execute: executeHistoryQuery,
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
  const loadOlder = useEvent((): Promise<void> => history.resource.loadOlder());
  const loadNewer = useEvent((): Promise<void> => history.resource.loadNewer());
  const loadActivity = useTurnActivityLoader(runtime, owner);
  const settleHistoryWindow = useEvent((direction: "newer" | "older") =>
    history.resource.settle(direction),
  );
  const [composerError, setComposerError] = useState<string | null>(null);
  const [lockedActivation, setLockedActivation] = useState<{
    correlationId: string;
    operationId: string;
  } | null>(null);
  const [terminalBlocked, setTerminalBlocked] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [clearVersion, setClearVersion] = useState(0);
  const [resourceMenuVisible, setResourceMenuVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const receiveSettlement = useEvent((settlement: CommandSettlement) => {
    if (
      lockedActivation === null ||
      settlement.correlationId !== lockedActivation.correlationId ||
      settlement.operationId !== lockedActivation.operationId
    ) {
      return;
    }
    setLockedActivation(null);
    if (settlement.kind === "notCreated") {
      setTerminalBlocked(false);
      setComposerError(settlement.failure.message);
      return;
    }
    if (settlement.kind === "terminal") {
      if (completedCurrentTurn(settlement.frame, owner.threadId)) {
        setTerminalBlocked(false);
        setComposerError(null);
        setComposerText("");
        setClearVersion((version) => version + 1);
        return;
      }
      setTerminalBlocked(true);
      setComposerError(composerTerminalMessage(settlement.frame));
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
  const locallyLocked =
    lockedActivation !== null &&
    correlations.isLocked(lockedActivation.correlationId, lockedActivation.operationId);
  const editComposer = useEvent(() => {
    setTerminalBlocked(false);
    setComposerError(null);
  });
  const addTranscript = useEvent((text: string) => {
    setComposerText((current) => (current.trim() === "" ? text : `${current.trimEnd()} ${text}`));
  });
  const voice = useVoiceInputControl({
    audience: owner.savedServerId,
    live: snapshot.value.state === "live" && snapshot.value.projections.live !== null,
    onTranscript: addTranscript,
    projection: snapshot.value.projections.live,
    scope: { id: owner.threadId, kind: "composer" },
    thread: owner,
  });
  const closeResourceMenu = useEvent(() => setResourceMenuVisible(false));
  const openThreadResource = useEvent(async (id: ThreadResourceName): Promise<void> => {
    await onOpenResource(id);
  });
  const closeSearch = useEvent(() => {
    setSearchQuery("");
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
      openThreadResource("agents").catch(() => setComposerError("Could not open skills."));
      return;
    }
    setComposerError(
      id === "drawing" ? "Drawing is not available yet." : "Goal is not available yet.",
    );
  });
  const openContext = useEvent((id: string) => {
    if (isThreadResourceName(id)) {
      openThreadResource(id).catch(() => setComposerError("Could not open thread resource."));
    } else if (id === "ports") {
      Promise.resolve(onOpenPorts()).catch(() => setComposerError("Could not open ports."));
    } else setResourceMenuVisible(true);
  });
  const agentCount = (projection?.catalog ?? []).filter(
    (value) => value.thread.parentId === owner.threadId,
  ).length;
  const contextItems = useThreadControlChips({
    agentCount,
    modelsSnapshot,
    owner,
    portCount: portsSnapshot.value.ports.length,
    resourcesResult: threadResourcesSnapshot.value,
    runtime,
    setError: setComposerError,
    settings: window?.thread.settings ?? null,
    threadWindow: window,
  });
  const timelineTurns = timelineTurnsDisplayModel(history.snapshot.turns);
  const sessionUsage = sessionUsagePresentation(timelineTurns);
  const contextUsage = contextUsagePresentation(
    timelineTurns,
    window?.thread.settings?.model ?? null,
  );
  const visibleTimelineTurns = filterTimelineTurns(timelineTurns, searchQuery);
  const submitMessage = useEvent(async (text: string): Promise<boolean> => {
    setComposerError(null);
    const settlement = await runtime.commands
      .executeCorrelated(
        {
          savedServerId: owner.savedServerId,
          surface: "threadComposer",
          threadId: owner.threadId,
        },
        {
          input: [{ kind: "text", text }],
          intent: "chat",
          kind: "turn.submit",
          settings: null,
          threadId: owner.threadId,
          workspace: null,
        },
      )
      .catch(() => null);
    if (settlement === null) {
      setComposerError("Action failed. Try again.");
      return false;
    }
    if (settlement.kind === "notCreated") {
      setTerminalBlocked(false);
      setComposerError(settlement.failure.message);
      return false;
    }
    if (settlement.kind === "durableUnsettled") {
      correlations.retainLock(settlement);
      setLockedActivation({
        correlationId: settlement.correlationId,
        operationId: settlement.operationId,
      });
      setComposerError(settlement.failure.message);
      return false;
    }
    if (!completedCurrentTurn(settlement.frame, owner.threadId)) {
      setTerminalBlocked(true);
      setComposerError(composerTerminalMessage(settlement.frame));
      return false;
    }
    setTerminalBlocked(false);
    return true;
  });
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
  return (
    <ConversationSurface
      accounts={accountUsagePresentation(accountsSnapshot.value, runtime.now())}
      archived={window?.thread.archived === true}
      canLoadNewer={searchQuery.trim() === "" && history.snapshot.canLoadNewer}
      canLoadOlder={searchQuery.trim() === "" && history.snapshot.canLoadOlder}
      clearVersion={clearVersion}
      composerError={composerError}
      composerText={composerText}
      contextItems={contextItems}
      contextUsage={contextUsage}
      desktop={isDesktopWindow({ height, width })}
      live={snapshot.value.state === "live"}
      locallyLocked={locallyLocked}
      onBack={onBack}
      onChangeSearchQuery={setSearchQuery}
      onCloseResourceMenu={closeResourceMenu}
      onCloseSearch={closeSearch}
      onComposerError={setComposerError}
      onEditComposer={editComposer}
      onLoadNewer={loadNewer}
      onLoadOlder={loadOlder}
      onLoadActivity={loadActivity}
      onOpenContext={openContext}
      onSelectComposerAction={selectComposerAction}
      onSelectResource={selectResource}
      onSettleWindow={settleHistoryWindow}
      onSubmitMessage={submitMessage}
      onTextChange={setComposerText}
      onToggleSearch={toggleSearch}
      owner={owner}
      resourceMenuVisible={resourceMenuVisible}
      retryBlocked={terminalBlocked}
      searchQuery={searchQuery}
      searchVisible={searchVisible}
      sessionUsage={sessionUsage}
      subtitle={subtitle}
      title={title}
      turns={visibleTimelineTurns}
      unsettledCount={unsettledCount}
      voice={voice}
    />
  );
}

function useTurnActivityLoader(
  runtime: V2Runtime,
  owner: QualifiedThread,
): (turnId: string) => Promise<TimelineDisplayActivity[]> {
  return useEvent(async (turnId: string): Promise<TimelineDisplayActivity[]> => {
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
    return items.flatMap(activityDisplayModel);
  });
}

interface ConversationSurfaceProps {
  accounts: readonly UsageAccountViewModel[];
  archived: boolean;
  canLoadNewer: boolean;
  canLoadOlder: boolean;
  clearVersion: number;
  composerError: string | null;
  composerText: string;
  contextItems: ComposerContextItem[];
  contextUsage: UsageContextViewModel | null;
  desktop: boolean;
  live: boolean;
  locallyLocked: boolean;
  onBack(): void;
  onChangeSearchQuery(query: string): void;
  onCloseResourceMenu(): void;
  onCloseSearch(): void;
  onComposerError(message: string | null): void;
  onEditComposer(): void;
  onOpenContext(id: string): void;
  onLoadNewer(): Promise<void>;
  onLoadOlder(): Promise<void>;
  onLoadActivity(turnId: string): Promise<TimelineDisplayActivity[]>;
  onSelectComposerAction(id: string): void;
  onSelectResource(id: string): void;
  onSubmitMessage(text: string): Promise<boolean>;
  onSettleWindow(direction: "newer" | "older"): void;
  onTextChange(text: string): void;
  onToggleSearch(): void;
  owner: QualifiedThread;
  resourceMenuVisible: boolean;
  retryBlocked: boolean;
  searchQuery: string;
  searchVisible: boolean;
  sessionUsage: UsageSessionViewModel | null;
  subtitle: string;
  title: string;
  turns: TimelineDisplayTurn[];
  unsettledCount: number;
  voice: VoiceInputControlModel;
}

function ConversationSurface(props: ConversationSurfaceProps): React.JSX.Element {
  const {
    accounts,
    archived,
    canLoadNewer,
    canLoadOlder,
    clearVersion,
    composerError,
    composerText,
    contextItems,
    contextUsage,
    desktop,
    live,
    locallyLocked,
    onBack,
    onChangeSearchQuery,
    onCloseResourceMenu,
    onCloseSearch,
    onComposerError,
    onEditComposer,
    onOpenContext,
    onLoadNewer,
    onLoadOlder,
    onLoadActivity,
    onSelectComposerAction,
    onSelectResource,
    onSubmitMessage,
    onSettleWindow,
    onTextChange,
    onToggleSearch,
    owner,
    resourceMenuVisible,
    retryBlocked,
    searchQuery,
    searchVisible,
    sessionUsage,
    subtitle,
    title,
    turns,
    unsettledCount,
    voice,
  } = props;
  return (
    <WorkspaceView
      subtitle={subtitle}
      leading={
        desktop ? undefined : (
          <TopBarActionView icon="back" label="Back to threads" onPress={onBack} />
        )
      }
      actions={
        <>
          <TopBarActionView
            active={searchVisible}
            icon="search"
            label="Search in thread"
            onPress={onToggleSearch}
          />
          <UsagePopoverView
            accounts={accounts}
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
            onBack={onBack}
            onError={onComposerError}
            owner={owner}
          />
        </>
      }
      title={title}
    >
      <MessageActionProviderView>
        <ConversationView>
          {searchVisible ? (
            <ConversationSearchView
              matchCount={turns.length}
              onChangeText={onChangeSearchQuery}
              onClose={onCloseSearch}
              query={searchQuery}
            />
          ) : null}
          <TimelineView
            canLoadNewer={canLoadNewer}
            canLoadOlder={canLoadOlder}
            onLoadNewer={onLoadNewer}
            onLoadOlder={onLoadOlder}
            onLoadActivity={onLoadActivity}
            onSettleWindow={onSettleWindow}
            timelineKey={`${owner.savedServerId}:${owner.threadId}`}
            turns={turns}
          />
          {unsettledCount === 0 ? null : (
            <ProductText accessibilityLiveRegion="polite" tone="warning">
              {unsettledCount} saved message{unsettledCount === 1 ? " is" : "s are"} waiting for the
              server
            </ProductText>
          )}
          <ComposerContextStripView items={contextItems} onOpen={onOpenContext} />
          <ChatComposer
            key={clearVersion}
            disabled={!live}
            error={composerError}
            locked={locallyLocked}
            menuActions={COMPOSER_ACTIONS}
            onEdit={onEditComposer}
            onSelectMenu={onSelectComposerAction}
            onSubmit={onSubmitMessage}
            retryBlocked={retryBlocked}
            onTextChange={onTextChange}
            text={composerText}
            voice={voice}
          />
          <ActionSheetView
            items={RESOURCE_ACTIONS}
            onClose={onCloseResourceMenu}
            onSelect={onSelectResource}
            title="Thread"
            visible={resourceMenuVisible}
          />
        </ConversationView>
      </MessageActionProviderView>
    </WorkspaceView>
  );
}

function sessionUsagePresentation(turns: TimelineDisplayTurn[]) {
  const usage = latestTimelineUsage(turns);
  if (usage === null) return null;
  return {
    compactions: null,
    costUsd: usage.threadTotalCostUsd,
    inputTokens: usage.threadInputTokens,
    outputTokens: usage.threadOutputTokens,
    totalTokens: usage.threadTotalTokens,
  };
}

function contextUsagePresentation(turns: TimelineDisplayTurn[], model: string | null) {
  const usage = latestTimelineUsage(turns, true);
  if (usage === null || usage.modelContextWindow === null) return null;
  const totalTokens = usage.modelContextWindow;
  const usedTokens = Math.max(0, usage.latestRequestTokens);
  return {
    availableTokens: Math.max(0, totalTokens - usedTokens),
    model,
    percent: Math.max(0, Math.min(100, (usedTokens / totalTokens) * 100)),
    totalTokens,
    usedTokens,
  };
}

function latestTimelineUsage(turns: TimelineDisplayTurn[], requireContext = false) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const usage = turns[index]?.usage ?? null;
    if (usage !== null && (!requireContext || (usage.modelContextWindow ?? 0) > 0)) return usage;
  }
  return null;
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
    agentCount,
    modelsSnapshot,
    owner,
    portCount,
    resourcesResult,
    runtime,
    setError,
    settings,
    threadWindow,
  } = input;
  const [settingsPending, startSettingsUpdate] = useTransition();
  const updateThreadSettings = useEvent((next: V2ThreadSettings) => {
    if (settingsPending) return;
    setError(null);
    startSettingsUpdate(async () => {
      try {
        const frame = await runtime.commands.execute(owner.savedServerId, {
          change: { kind: "settings", settings: next },
          kind: "thread.update",
          threadId: owner.threadId,
        });
        if (frame.type !== "commandCompleted") setError(frame.error.message);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : "Could not update thread settings.");
      }
    });
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
    const next = nextPermissionSettings(id, settings);
    if (next === null) {
      setError("Permission settings are unavailable.");
      return;
    }
    updateThreadSettings(next);
  });
  return composerContextItems({
    agentCount,
    modelsError: modelsSnapshot.status === "error" ? modelsSnapshot.message : null,
    modelsLoading: modelsSnapshot.status === "loading",
    modelsResult: modelsSnapshot.value,
    onSelectModel: selectModel,
    onSelectPermissions: selectPermissions,
    portCount,
    resourcesResult,
    settingsPending,
    threadWindow,
  });
}

function composerContextItems(input: ComposerContextItemsInput): ComposerContextItem[] {
  const {
    agentCount,
    modelsError,
    modelsLoading,
    modelsResult,
    onSelectModel,
    onSelectPermissions,
    portCount,
    resourcesResult,
    settingsPending,
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
  const access = accessLabel(settings);
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
        actions: modelMenuActions(models, settings, modelsLoading, modelsError).map((action) =>
          settingsPending ? { ...action, disabled: true } : action,
        ),
        menuWidth: 344,
        onSelect: onSelectModel,
      },
    },
    {
      icon: "shield",
      id: "permissions",
      label: access,
      loading: settingsPending,
      menu: {
        accessibilityLabel: `Permissions: ${access}`,
        actions: permissionMenuActions(settings, settingsPending),
        menuWidth: 344,
        onSelect: onSelectPermissions,
      },
    },
  ];
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
  return items;
}

function modelMenuActions(
  models: ModelsResult["models"],
  settings: V2ThreadSettings | null,
  loading: boolean,
  error: string | null,
): ActionMenuItem[] {
  const selected = models.find((model) => model.id === settings?.model) ?? models[0];
  const efforts = selected?.efforts ?? [];
  const unavailable = settings === null;
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
      label: thinkingEffortLabel(effort),
      section: "Thinking level",
      selected: effort === settings?.effort,
    })),
  ];
}

function permissionMenuActions(
  settings: V2ThreadSettings | null,
  pending: boolean,
): ActionMenuItem[] {
  const disabled = settings === null || pending;
  return [
    {
      disabled,
      id: "sandbox:readOnly",
      label: "Read only",
      section: "Security permissions",
      selected: settings?.sandbox === "readOnly",
    },
    {
      disabled,
      id: "sandbox:workspaceWrite",
      label: "Workspace",
      section: "Security permissions",
      selected: settings?.sandbox === "workspaceWrite",
    },
    {
      disabled,
      id: "sandbox:unrestricted",
      label: "Full access",
      section: "Security permissions",
      selected: settings?.sandbox === "unrestricted",
    },
    {
      disabled,
      id: "approval:never",
      label: "Never ask",
      section: "Approval policy",
      selected: settings?.approvalPolicy === "never",
    },
    {
      disabled,
      id: "approval:onRequest",
      label: "Ask when needed",
      section: "Approval policy",
      selected: settings?.approvalPolicy === "onRequest",
    },
    {
      disabled,
      id: "approval:untrusted",
      label: "Untrusted commands",
      section: "Approval policy",
      selected: settings?.approvalPolicy === "untrusted",
    },
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
    return { ...settings, effort: compatibleEffort(model, settings.effort), model: model.id };
  }
  if (!id.startsWith("effort:") || settings.model === null) return null;
  const effort = id.slice("effort:".length);
  const model = result.models.find((candidate) => candidate.id === settings.model);
  if (model === undefined || !isThreadEffort(effort) || !model.efforts.includes(effort))
    return null;
  return { ...settings, effort };
}

function nextPermissionSettings(
  id: string,
  settings: V2ThreadSettings | null,
): V2ThreadSettings | null {
  if (settings === null) return null;
  if (id === "sandbox:readOnly") return { ...settings, sandbox: "readOnly" };
  if (id === "sandbox:workspaceWrite") return { ...settings, sandbox: "workspaceWrite" };
  if (id === "sandbox:unrestricted") return { ...settings, sandbox: "unrestricted" };
  if (id === "approval:never") return { ...settings, approvalPolicy: "never" };
  if (id === "approval:onRequest") return { ...settings, approvalPolicy: "onRequest" };
  if (id === "approval:untrusted") return { ...settings, approvalPolicy: "untrusted" };
  return null;
}

function compatibleEffort(
  model: ModelsResult["models"][number],
  current: V2ThreadSettings["effort"],
): V2ThreadSettings["effort"] {
  if (current !== null && model.efforts.includes(current)) return current;
  if (model.defaultEffort !== null && isThreadEffort(model.defaultEffort))
    return model.defaultEffort;
  return model.efforts[0] ?? null;
}

function isThreadEffort(value: string): value is ThreadEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function thinkingEffortLabel(effort: ThreadEffort): string {
  if (effort === "xhigh") return "Extra high";
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function accessLabel(settings: V2ThreadWindow["thread"]["settings"]): string {
  if (settings === null || settings === undefined) return "Access";
  const sandbox =
    settings.sandbox === "unrestricted"
      ? "Full access"
      : settings.sandbox === "workspaceWrite"
        ? "Workspace"
        : "Read only";
  const approval =
    settings.approvalPolicy === "never"
      ? null
      : settings.approvalPolicy === "onRequest"
        ? "Ask"
        : "Untrusted";
  return approval === null ? sandbox : `${sandbox} · ${approval}`;
}

function isThreadResourceName(value: string): value is ThreadResourceName {
  return (
    value === "agents" || value === "attachments" || value === "changes" || value === "terminal"
  );
}

function filterTimelineTurns(turns: TimelineDisplayTurn[], query: string): TimelineDisplayTurn[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return turns;
  return turns.filter((turn) => timelineTurnText(turn).toLocaleLowerCase().includes(needle));
}

function timelineTurnText(turn: TimelineDisplayTurn): string {
  const activities = turn.activities.map(
    (activity) => `${activity.label} ${activity.detail ?? ""} ${activity.state ?? ""}`,
  );
  return [
    ...turn.userText,
    ...turn.assistantText,
    ...turn.lifecycle.map((value) => {
      const { label } = value;
      return label;
    }),
    ...activities,
    turn.state,
  ].join(" ");
}

function completedCurrentTurn(frame: V2CommandTerminalFrame, threadId: string): boolean {
  return (
    frame.type === "commandCompleted" &&
    frame.result.kind === "turn.submit" &&
    frame.result.threadId === threadId
  );
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
