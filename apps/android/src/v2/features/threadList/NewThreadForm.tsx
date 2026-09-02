import type { V2CommandTerminalFrame, V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { TopBarActionView } from "../../presentation/actions/TopBarActionView";
import { ConversationView } from "../../presentation/conversation/ConversationView";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { isDesktopWindow } from "../../presentation/layouts/windowLayout";
import {
  ProjectPickerView,
  type ProjectPickerRow,
} from "../../presentation/navigation/ProjectPickerView";
import { ProductText } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, typeScale } from "../../presentation/tokens";
import { useEvent } from "../../../react/useEvent";
import type { CommandSettlement } from "../../application/commandCorrelation";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QueryResource } from "../../application/resources/queryResource";
import { ObservableResource } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";
import { ChatComposer } from "../composer/ChatComposer";

const EMPTY_QUERY_RESOURCE = new ObservableResource<V2QueryResult | null>(null);

interface NewThreadFormProps {
  onBack(): void;
  onThreadCreated(threadId: string): void;
  savedServerId: SavedServerId;
}

interface NewThreadComposerProps extends NewThreadFormProps {
  projectResource: QueryResource | null;
}

interface LockedActivation {
  correlationId: string;
  operationId: string;
}

export function NewThreadForm(props: NewThreadFormProps): React.JSX.Element {
  const { onBack, onThreadCreated, savedServerId } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.query(savedServerId, { kind: "projects.list" }));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  return (
    <NewThreadComposer
      onBack={onBack}
      onThreadCreated={onThreadCreated}
      projectResource={opened.value}
      savedServerId={savedServerId}
    />
  );
}

function NewThreadComposer(props: NewThreadComposerProps): React.JSX.Element {
  const { onBack, onThreadCreated, projectResource, savedServerId } = props;
  const runtime = useV2Runtime();
  const window = useWindowDimensions();
  const resource = projectResource ?? EMPTY_QUERY_RESOURCE;
  const projectSnapshot = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  const projects = projectRows(projectSnapshot.value);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null | undefined>(undefined);
  const workspace =
    selectedWorkspace === undefined ? (projects[0]?.path ?? null) : selectedWorkspace;
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activationLocked, setActivationLocked] = useState(false);
  const [lockedActivation, setLockedActivation] = useState<LockedActivation | null>(null);
  const [terminalBlocked, setTerminalBlocked] = useState(false);
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
      setError(settlement.failure.message);
      return;
    }
    if (settlement.kind === "terminal") {
      const createdThreadId = completedThreadId(settlement.frame);
      if (createdThreadId !== null) {
        onThreadCreated(createdThreadId);
        return;
      }
      setTerminalBlocked(true);
      setError(newThreadTerminalMessage(settlement.frame));
    }
  });
  const [correlations] = useState(() =>
    runtime.commandCorrelations(
      {
        savedServerId,
        surface: "newThread",
        threadId: null,
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
  const draftLocked = activationLocked || locallyLocked;
  const editMessage = useEvent((value: string): void => {
    setMessage(value);
    setTerminalBlocked(false);
    setError(null);
  });
  const editComposer = useEvent(() => {
    setTerminalBlocked(false);
    setError(null);
  });
  const openProjectPicker = useEvent(() => setProjectPickerVisible(true));
  const changeProjectPicker = useEvent((visible: boolean) => setProjectPickerVisible(visible));
  const selectProject = useEvent((path: string | null): Promise<void> => {
    setSelectedWorkspace(path);
    return Promise.resolve();
  });
  const submitMessage = useEvent(async (text: string): Promise<boolean> => {
    setError(null);
    setActivationLocked(true);
    const settlement = await runtime.commands
      .executeCorrelated(
        {
          savedServerId,
          surface: "newThread",
          threadId: null,
        },
        {
          input: [{ kind: "text", text }],
          intent: "chat",
          kind: "turn.submit",
          settings: {
            approvalPolicy: "onRequest",
            effort: null,
            model: null,
            sandbox: "workspaceWrite",
          },
          threadId: null,
          workspace,
        },
      )
      .catch(() => null);
    setActivationLocked(false);
    if (settlement === null) {
      setError("Action failed. Try again.");
      return false;
    }
    if (settlement.kind === "notCreated") {
      setTerminalBlocked(false);
      setError(settlement.failure.message);
      return false;
    }
    if (settlement.kind === "durableUnsettled") {
      correlations.retainLock(settlement);
      setLockedActivation({
        correlationId: settlement.correlationId,
        operationId: settlement.operationId,
      });
      setError(settlement.failure.message);
      return false;
    }
    const createdThreadId = completedThreadId(settlement.frame);
    if (createdThreadId === null) {
      setTerminalBlocked(true);
      setError(newThreadTerminalMessage(settlement.frame));
      return false;
    }
    onThreadCreated(createdThreadId);
    return true;
  });
  const projectStatus = projectSnapshot.status === "error" ? projectSnapshot.message : null;
  return (
    <WorkspaceView
      leading={
        isDesktopWindow(window) ? undefined : (
          <TopBarActionView icon="back" label="Back to threads" onPress={onBack} />
        )
      }
      subtitle={
        <ProductText numberOfLines={1} tone="muted">
          {workspace ?? "Server default"}
        </ProductText>
      }
      title="New Chat"
    >
      <ConversationView>
        <View style={styles.emptyState}>
          <ProductText style={styles.prompt} weight="semibold">
            What would you like to work on?
          </ProductText>
          <Pressable
            accessibilityLabel={`Change project, currently ${projectName(workspace)}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: draftLocked }}
            disabled={draftLocked}
            onPress={openProjectPicker}
            style={[styles.projectButton, draftLocked && styles.disabled]}
          >
            <ProductText numberOfLines={1} style={styles.projectText}>
              in {projectName(workspace)}
            </ProductText>
            <ProductText style={styles.chevron}>⌄</ProductText>
          </Pressable>
          {projectResource !== null && projectSnapshot.value === null ? (
            <ShimmerText style={styles.projectLoading} text="Reading projects…" />
          ) : null}
          {projectStatus === null ? null : (
            <ProductText accessibilityLiveRegion="polite" tone="danger">
              {projectStatus}
            </ProductText>
          )}
        </View>
        {unsettledCount === 0 ? null : (
          <ProductText accessibilityLiveRegion="polite" style={styles.pending} tone="warning">
            {unsettledCount} saved action{unsettledCount === 1 ? " is" : "s are"} waiting for the
            server
          </ProductText>
        )}
        <ChatComposer
          disabled={activationLocked}
          error={error}
          locked={locallyLocked}
          onEdit={editComposer}
          onSubmit={submitMessage}
          onTextChange={editMessage}
          retryBlocked={terminalBlocked}
          text={message}
        />
        <ProjectPickerView
          currentPath={workspace}
          isOpen={projectPickerVisible}
          onOpenChange={changeProjectPicker}
          onSelect={selectProject}
          projects={projects}
        />
      </ConversationView>
    </WorkspaceView>
  );
}

function projectRows(result: V2QueryResult | null): ProjectPickerRow[] {
  if (result?.kind !== "projects.list") return [];
  return result.projects.map((project) => ({
    id: project.path,
    label: project.name,
    path: project.path,
    pinned: project.pinned,
  }));
}

function projectName(path: string | null): string {
  if (path === null) return "server default";
  const normalized = path.replace(/[\\/]+$/u, "");
  const label = normalized.split(/[\\/]/u).at(-1);
  return label === undefined || label === "" ? path : label;
}

function completedThreadId(frame: V2CommandTerminalFrame): string | null {
  return frame.type === "commandCompleted" && frame.result.kind === "turn.submit"
    ? frame.result.threadId
    : null;
}

function newThreadTerminalMessage(frame: V2CommandTerminalFrame): string {
  if (frame.type === "commandIndeterminate") {
    return "The saved action outcome is unknown. Change the draft before trying again.";
  }
  if (frame.type === "commandExpired") {
    return "The saved action expired. Change the draft before trying again.";
  }
  if (frame.type === "commandFailed") {
    return "The server rejected the saved action. Change the draft before trying again.";
  }
  return "The saved action completed without creating a thread. Change the draft before trying again.";
}

const styles = StyleSheet.create({
  chevron: { color: colors.accent, ...typeScale.title },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  disabled: { opacity: 0.45 },
  pending: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  projectButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  projectText: { color: colors.accent, flexShrink: 1, minWidth: 0, ...typeScale.title },
  projectLoading: { color: colors.textMuted, ...typeScale.caption },
  prompt: { ...typeScale.heading, textAlign: "center" },
});
