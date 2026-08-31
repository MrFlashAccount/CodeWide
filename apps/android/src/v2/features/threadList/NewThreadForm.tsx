import { useState, useSyncExternalStore } from "react";
import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { CommandSettlement } from "../../application/commandCorrelation";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";

export function NewThreadForm({
  onThreadCreated,
  savedServerId,
}: {
  onThreadCreated(threadId: string): void;
  savedServerId: SavedServerId;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const [workspace, setWorkspace] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activationLocked, setActivationLocked] = useState(false);
  const [lockedActivation, setLockedActivation] = useState<{
    correlationId: string;
    operationId: string;
  } | null>(null);
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
      const threadId = completedThreadId(settlement.frame);
      if (threadId !== null) {
        onThreadCreated(threadId);
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
    correlationSnapshot.value.map(({ correlationId }) => correlationId),
  );
  if (lockedActivation !== null) unsettledCorrelationIds.add(lockedActivation.correlationId);
  const unsettledCount = unsettledCorrelationIds.size;
  const locallyLocked =
    lockedActivation !== null &&
    correlations.isLocked(lockedActivation.correlationId, lockedActivation.operationId);
  const ready =
    workspace.trim() !== "" &&
    message.trim() !== "" &&
    !locallyLocked &&
    !activationLocked &&
    !terminalBlocked;
  const editWorkspace = (value: string): void => {
    setWorkspace(value);
    setTerminalBlocked(false);
  };
  const editMessage = (value: string): void => {
    setMessage(value);
    setTerminalBlocked(false);
  };
  return (
    <WorkspaceView title="New thread">
      <View style={styles.form}>
        <Text style={styles.label}>Workspace</Text>
        <TextInput
          accessibilityLabel="Workspace path"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!activationLocked && !locallyLocked}
          onChangeText={editWorkspace}
          placeholder="/workspace/project"
          placeholderTextColor="#77777c"
          style={styles.input}
          value={workspace}
        />
        <Text style={styles.label}>First message</Text>
        <TextInput
          accessibilityLabel="First message"
          editable={!activationLocked && !locallyLocked}
          multiline
          onChangeText={editMessage}
          placeholder="What should Codex do?"
          placeholderTextColor="#77777c"
          style={[styles.input, styles.message]}
          value={message}
        />
        {error === null ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        )}
        {unsettledCount === 0 ? null : (
          <Text accessibilityLiveRegion="polite" style={styles.pending}>
            {unsettledCount} saved action{unsettledCount === 1 ? " is" : "s are"} waiting for the
            server
          </Text>
        )}
        <ActionPressable
          action={{
            disabled: !ready,
            id: "create-thread",
            label: "Create thread",
            run: async () => {
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
                    input: [{ kind: "text", text: message.trim() }],
                    intent: "chat",
                    kind: "turn.submit",
                    settings: {
                      approvalPolicy: "onRequest",
                      effort: null,
                      model: null,
                      sandbox: "workspaceWrite",
                    },
                    threadId: null,
                    workspace: workspace.trim(),
                  },
                )
                .catch(() => null);
              if (settlement === null) {
                setActivationLocked(false);
                setError("Action failed. Try again.");
                return;
              }
              if (settlement.kind === "notCreated") {
                setActivationLocked(false);
                setTerminalBlocked(false);
                setError(settlement.failure.message);
                return;
              }
              if (settlement.kind === "durableUnsettled") {
                correlations.retainLock(settlement);
                setLockedActivation({
                  correlationId: settlement.correlationId,
                  operationId: settlement.operationId,
                });
                setActivationLocked(false);
                setError(settlement.failure.message);
                return;
              }
              setActivationLocked(false);
              const threadId = completedThreadId(settlement.frame);
              if (threadId === null) {
                setTerminalBlocked(true);
                setError(newThreadTerminalMessage(settlement.frame));
                return;
              }
              onThreadCreated(threadId);
            },
          }}
        />
      </View>
    </WorkspaceView>
  );
}

const styles = StyleSheet.create({
  error: { color: "#ff8b8b" },
  form: { gap: 10, padding: 16 },
  input: {
    backgroundColor: "#1b1b1e",
    borderRadius: 10,
    color: "#fafafa",
    minHeight: 48,
    padding: 12,
  },
  label: { color: "#d0d0d4", fontSize: 13, fontWeight: "600" },
  message: { minHeight: 120, textAlignVertical: "top" },
  pending: { color: "#e9872c" },
});

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
