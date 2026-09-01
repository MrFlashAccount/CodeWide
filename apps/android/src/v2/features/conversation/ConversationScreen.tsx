import type {
  V2CommandTerminalFrame,
  V2QueryResult,
  V2ThreadWindow,
} from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, useWindowDimensions } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { ActionSheetView, type ActionSheetItem } from "../../presentation/actions/ActionSheetView";
import { TopBarActionView } from "../../presentation/actions/TopBarActionView";
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
import { timelineDisplayModel } from "./timelineDisplayModel";
import { accountUsagePresentation } from "../accounts/accountUsagePresentation";

type ThreadResourceName = "agents" | "attachments" | "changes" | "terminal";

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
        <ActivityIndicator accessibilityLabel="Opening V2 conversation" />
      </WorkspaceView>
    );
  }
  return (
    <ProjectedConversation
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
  const contextItems = composerContextItems(
    window,
    modelsSnapshot.value,
    threadResourcesSnapshot.value,
    portsSnapshot.value.ports.length,
  );
  const timelineTurns = timelineDisplayModel(window);
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
      onOpenContext={openContext}
      onSelectComposerAction={selectComposerAction}
      onSelectResource={selectResource}
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

interface ConversationSurfaceProps {
  accounts: readonly UsageAccountViewModel[];
  archived: boolean;
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
  onSelectComposerAction(id: string): void;
  onSelectResource(id: string): void;
  onSubmitMessage(text: string): Promise<boolean>;
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
    onSelectComposerAction,
    onSelectResource,
    onSubmitMessage,
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
          <TimelineView turns={turns} />
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

function composerContextItems(
  window: V2ThreadWindow | null,
  modelsResult: V2QueryResult | null,
  resourcesResult: V2QueryResult | null,
  portCount: number,
): ComposerContextItem[] {
  const settings = window?.thread.settings;
  const models = modelsResult?.kind === "models.list" ? modelsResult.models : [];
  const selectedModel = models.find((value) => {
    const { id } = value;
    return id === settings?.model;
  });
  const model = selectedModel?.label ?? settings?.model ?? "Model";
  const effort = settings?.effort ?? selectedModel?.defaultEffort ?? "default";
  const access = accessLabel(settings ?? null);
  const changes = resourcesResult?.kind === "thread.resources" ? resourcesResult.changes : null;
  const attachments =
    resourcesResult?.kind === "thread.resources" ? resourcesResult.attachments : null;
  const items: ComposerContextItem[] = [
    { icon: "sparkles", id: "model", label: `${model} · ${effort}` },
    { icon: "shield", id: "permissions", label: access },
    {
      icon: "changes",
      id: "changes",
      label:
        changes === null
          ? "Changes"
          : changes.length === 0
            ? "No changes"
            : `Changes · ${changes.length}`,
    },
    {
      disabled: attachments?.length === 0,
      icon: "attach",
      id: "attachments",
      label:
        attachments === null
          ? "Attachments"
          : attachments.length === 0
            ? "No attachments"
            : `Attachments · ${attachments.length}`,
    },
  ];
  if (portCount > 0) items.push({ icon: "ports", id: "ports", label: `Ports: ${portCount}` });
  return items;
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
