import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { CommandSettlement } from "../../application/commandCorrelation";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";
import { ConversationView } from "../../ui/conversation/ConversationView";
import { TimelineView } from "../../ui/conversation/TimelineView";
import { ChatComposer } from "../composer/ChatComposer";
import { VoiceInputControl } from "./VoiceInputControl";
import { timelineDisplayModel } from "./timelineDisplayModel";
import { ActionPressable } from "../../ui/actions/ActionPressable";

type ThreadResourceName = "agents" | "attachments" | "changes" | "terminal";

export function ConversationScreen({
  onOpenResource,
  owner,
}: {
  onOpenResource(resourceName: ThreadResourceName): void | Promise<void>;
  owner: QualifiedThread;
}): React.JSX.Element {
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
    <ProjectedConversation onOpenResource={onOpenResource} owner={owner} resource={opened.value} />
  );
}

function ProjectedConversation({
  onOpenResource,
  owner,
  resource,
}: {
  onOpenResource(resourceName: ThreadResourceName): void | Promise<void>;
  owner: QualifiedThread;
  resource: ProjectionResource;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
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
    correlationSnapshot.value.map(({ correlationId }) => correlationId),
  );
  if (lockedActivation !== null) unsettledCorrelationIds.add(lockedActivation.correlationId);
  const unsettledCount = unsettledCorrelationIds.size;
  const locallyLocked =
    lockedActivation !== null &&
    correlations.isLocked(lockedActivation.correlationId, lockedActivation.operationId);
  return (
    <WorkspaceView
      subtitle={
        <Text style={{ color: snapshot.value.state === "live" ? "#35c778" : "#e9872c" }}>
          {snapshot.value.state}
        </Text>
      }
      title={window?.thread.title ?? "Conversation"}
    >
      <ConversationView>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {(["attachments", "changes", "terminal", "agents"] as const).map((resourceName) => (
            <ActionPressable
              key={resourceName}
              action={{
                id: `open-${resourceName}`,
                label: resourceName.charAt(0).toUpperCase() + resourceName.slice(1),
                run: () => onOpenResource(resourceName),
              }}
            />
          ))}
        </View>
        <TimelineView rows={timelineDisplayModel(window)} />
        {unsettledCount === 0 ? null : (
          <Text accessibilityLiveRegion="polite" style={{ color: "#e9872c" }}>
            {unsettledCount} saved message{unsettledCount === 1 ? " is" : "s are"} waiting for the
            server
          </Text>
        )}
        <ChatComposer
          key={clearVersion}
          disabled={snapshot.value.state !== "live"}
          error={composerError}
          locked={locallyLocked}
          onEdit={() => {
            setTerminalBlocked(false);
            setComposerError(null);
          }}
          onSubmit={async (text) => {
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
          }}
          retryBlocked={terminalBlocked}
          onTextChange={setComposerText}
          text={composerText}
        />
        <VoiceInputControl
          live={snapshot.value.state === "live" && snapshot.value.projections.live !== null}
          onTranscript={setComposerText}
          owner={owner}
          projection={snapshot.value.projections.live}
        />
      </ConversationView>
    </WorkspaceView>
  );
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
