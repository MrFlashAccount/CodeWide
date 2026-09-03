import { Ionicons } from "@expo/vector-icons";
import type { V2BackgroundProcess } from "@codewide/sync-client/v2";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import type { TerminalSession } from "../../domain/terminalSession";
import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { actionFailure } from "../actions/actionFailure";
import { AsyncActionFeedbackView } from "../actions/AsyncActionFeedbackView";
import { ProductText as Text } from "../text/ProductText";
import { BackgroundProcessesView } from "./BackgroundProcessesView";
import { TerminalTabBarView, type TerminalTabViewModel } from "./TerminalTabBarView";

interface TerminalWorkspaceViewProps {
  activeTerminal: ReactNode;
  activeSession: TerminalSession | null;
  backgroundError: string | null;
  backgroundProcesses: readonly V2BackgroundProcess[];
  backgroundStatus: "error" | "loading" | "ready";
  backgroundsVisible: boolean;
  canCreate: boolean;
  error: string | null;
  onClose(id: string): Promise<void>;
  onCreate(): void | Promise<void>;
  onMinimize(): void;
  onRefreshBackgrounds(): void | Promise<void>;
  onRetryReplay(id: string): Promise<void>;
  onSelect(id: string): void;
  onTerminateBackground(processId: string): Promise<void>;
  onToggleBackgrounds(): void;
  tabs: readonly TerminalTabViewModel[];
}

type TerminalAction = () => void | Promise<void>;

interface TerminalActionRequest {
  action: TerminalAction;
  failure: string;
  pending: string;
}

export function TerminalWorkspaceView(props: TerminalWorkspaceViewProps): React.JSX.Element {
  const terminalAction = useTerminalAction();
  const create = useEvent(() => {
    terminalAction.run({
      action: props.onCreate,
      failure: "Could not open terminal.",
      pending: "Opening terminal…",
    });
  });
  const close = useEvent((id: string) => {
    const title = props.tabs.find((tab) => tab.id === id)?.title ?? "terminal";
    terminalAction.run({
      action: () => props.onClose(id),
      failure: `Could not close ${title}.`,
      pending: `Closing ${title}…`,
    });
  });
  const retryReplay = useEvent(() => {
    if (props.activeSession === null) return;
    const id = props.activeSession.id;
    terminalAction.run({
      action: () => props.onRetryReplay(id),
      failure: "Could not retry terminal.",
      pending: "Starting new terminal…",
    });
  });
  const replayUnavailable = props.activeSession?.errorCode === "replayUnavailable";
  return (
    <View style={styles.root} testID="v2-terminal-workspace">
      <TerminalTabBarView
        actionsDisabled={terminalAction.pending}
        canCreate={props.canCreate && !terminalAction.pending}
        onClose={close}
        onCreate={create}
        onMinimize={props.onMinimize}
        onSelect={props.onSelect}
        onToggleBackgrounds={props.onToggleBackgrounds}
        sessionsTotal={props.backgroundProcesses.length}
        tabs={props.tabs}
      />
      {props.backgroundsVisible ? (
        <BackgroundProcessesView
          error={props.backgroundError}
          items={props.backgroundProcesses}
          onClose={props.onToggleBackgrounds}
          onRefresh={props.onRefreshBackgrounds}
          onTerminate={props.onTerminateBackground}
          status={props.backgroundStatus}
        />
      ) : null}
      {props.error === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.errorBanner}>
          <Ionicons color={colors.red} name="alert-circle-outline" size={17} />
          <Text selectable style={styles.errorText}>
            {props.error}
          </Text>
        </View>
      )}
      <AsyncActionFeedbackView
        error={terminalAction.error}
        onRetry={terminalAction.retry}
        pending={terminalAction.pending}
        pendingLabel={terminalAction.pendingLabel}
        testID="v2-terminal-action-feedback"
      />
      {replayUnavailable ? (
        <View
          accessibilityLiveRegion="assertive"
          style={styles.replayBanner}
          testID="v2-terminal-replay-unavailable"
        >
          <View style={styles.replayCopy}>
            <Text style={styles.replayTitle}>Terminal history is unavailable</Text>
            <Text style={styles.replayMessage}>
              The previous output could not be replayed. Retry starts a new shell.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Retry terminal after replay loss"
            accessibilityRole="button"
            accessibilityState={{ disabled: terminalAction.pending }}
            disabled={terminalAction.pending}
            onPress={retryReplay}
            style={[styles.retryButton, terminalAction.pending && styles.disabled]}
            testID="v2-terminal-replay-retry"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {props.activeTerminal ?? (
        <View style={styles.empty}>
          <Ionicons color={colors.textMuted} name="terminal-outline" size={30} />
          <Text style={styles.emptyTitle}>No terminal tabs</Text>
          <Pressable
            accessibilityLabel="Open terminal"
            accessibilityRole="button"
            accessibilityState={{ disabled: !props.canCreate || terminalAction.pending }}
            disabled={!props.canCreate || terminalAction.pending}
            onPress={create}
            style={[
              styles.createButton,
              (!props.canCreate || terminalAction.pending) && styles.disabled,
            ]}
          >
            <Ionicons color={colors.onPrimary} name="add" size={18} />
            <Text style={styles.createButtonText}>New terminal</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function useTerminalAction(): {
  error: string | null;
  pending: boolean;
  pendingLabel: string;
  retry(): void;
  run(request: TerminalActionRequest): void;
} {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("Working…");
  const running = useRef(false);
  const lastRequest = useRef<TerminalActionRequest | null>(null);
  const run = useEvent((request: TerminalActionRequest): void => {
    if (running.current) return;
    running.current = true;
    lastRequest.current = request;
    setError(null);
    setPendingLabel(request.pending);
    setPending(true);
    void invokeTerminalAction(request.action).then(
      () => {
        running.current = false;
        setPending(false);
      },
      (cause: unknown) => {
        running.current = false;
        setPending(false);
        setError(actionFailure(cause, request.failure));
      },
    );
  });
  const retry = useEvent((): void => {
    const request = lastRequest.current;
    if (request !== null) run(request);
  });
  return { error, pending, pendingLabel, retry, run };
}

async function invokeTerminalAction(action: TerminalAction): Promise<void> {
  await action();
}

const styles = StyleSheet.create({
  createButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  createButtonText: { color: colors.onPrimary, ...typeScale.body },
  disabled: { opacity: 0.4 },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyTitle: { color: colors.textMuted, ...typeScale.body },
  errorBanner: {
    alignItems: "center",
    backgroundColor: colors.errorContainer,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  errorText: { color: colors.red, flex: 1, ...typeScale.label },
  root: { backgroundColor: colors.background, flex: 1, minHeight: 0, minWidth: 0 },
  replayBanner: {
    alignItems: "center",
    backgroundColor: colors.errorContainer,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replayCopy: { flex: 1, gap: spacing.xs },
  replayMessage: { color: colors.textMuted, ...typeScale.caption },
  replayTitle: { color: colors.red, ...typeScale.label },
  retryButton: {
    alignItems: "center",
    borderColor: colors.red,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retryButtonText: { color: colors.red, ...typeScale.label },
});
