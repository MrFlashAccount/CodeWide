import { useState } from "react";
import { Pressable, View } from "react-native";
import type { ThreadForkOptions } from "../../data/thread-fork";
import { useEvent } from "../../react/useEvent";
import { AppText } from "../../ui/AppText";
import { styles } from "./LockedConversationComposer.styles";

type LockedComposerActionState =
  | { readonly status: "idle" }
  | { readonly action: "fork" | "retry"; readonly status: "pending" }
  | { readonly message: string; readonly status: "error" };

export function LockedConversationComposer({
  onFork,
  onRetry,
}: {
  onFork: ((options: ThreadForkOptions) => Promise<void>) | undefined;
  onRetry: (() => Promise<void>) | undefined;
}): React.JSX.Element {
  const [actionState, setActionState] = useState<LockedComposerActionState>({ status: "idle" });
  const pending = actionState.status === "pending";
  const retry = useEvent((): void => {
    if (pending || onRetry === undefined) {
      return;
    }
    setActionState({ action: "retry", status: "pending" });
    void onRetry().then(
      () => {
        setActionState({ status: "idle" });
      },
      (error: unknown) => {
        setActionState({
          message: error instanceof Error ? error.message : "Could not retry thread access.",
          status: "error",
        });
      },
    );
  });
  const fork = useEvent((): void => {
    if (pending || onFork === undefined) {
      return;
    }
    setActionState({ action: "fork", status: "pending" });
    void onFork({ boundary: { kind: "all" }, ephemeral: false }).catch((error: unknown) => {
      setActionState({
        message: error instanceof Error ? error.message : "Could not fork this conversation.",
        status: "error",
      });
    });
  });
  return (
    <View style={styles.root} testID="locked-conversation-composer">
      <AppText accessibilityRole="header" style={styles.title}>
        This is open in another app
      </AppText>
      <AppText style={styles.description}>
        You can follow updates here, or fork this conversation to continue.
      </AppText>
      {actionState.status === "error" && (
        <AppText accessibilityRole="alert" style={styles.error}>
          {actionState.message}
        </AppText>
      )}
      <View style={styles.actions}>
        <LockedComposerAction
          disabled={pending || onRetry === undefined}
          label="Retry"
          onPress={retry}
          pending={actionState.status === "pending" && actionState.action === "retry"}
          primary={false}
        />
        <LockedComposerAction
          disabled={pending || onFork === undefined}
          label="Fork"
          onPress={fork}
          pending={actionState.status === "pending" && actionState.action === "fork"}
          primary
        />
      </View>
    </View>
  );
}

function LockedComposerAction({
  disabled,
  label,
  onPress,
  pending,
  primary,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  pending: boolean;
  primary: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primaryAction,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <AppText shimmering={pending} style={[styles.actionLabel, primary && styles.primaryLabel]}>
        {label}
      </AppText>
    </Pressable>
  );
}
