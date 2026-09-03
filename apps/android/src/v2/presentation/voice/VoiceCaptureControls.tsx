import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { VoiceLevelMeter } from "./VoiceLevelMeter";

type VoiceCaptureState =
  | "idle"
  | "starting"
  | "recording"
  | "finishing"
  | "cancelling"
  | "retry"
  | "error";

export interface VoiceCaptureControlsProps {
  disabled: boolean;
  level: number;
  message: string | null;
  onCancel(): Promise<void>;
  onFailure(): void;
  onFinish(): Promise<void>;
  onRetry(): Promise<void>;
  onStart(): Promise<void>;
  state: VoiceCaptureState;
}

/**
 * Renders the complete Voice action state without owning microphone or transcript
 * lifetime. The process controller remains authoritative across route unmounts.
 */
export function VoiceCaptureControls(props: VoiceCaptureControlsProps): React.JSX.Element {
  const { disabled, level, message, onCancel, onFailure, onFinish, onRetry, onStart, state } =
    props;
  const [pending, setPending] = useState(false);
  const run = useEvent((action: () => Promise<void>): void => {
    if (pending) return;
    setPending(true);
    void action().then(
      () => setPending(false),
      () => {
        onFailure();
        setPending(false);
      },
    );
  });
  const cancel = useEvent(() => run(onCancel));
  const finish = useEvent(() => run(onFinish));
  const retry = useEvent(() => run(onRetry));
  const start = useEvent(() => run(onStart));
  const active =
    state === "starting" ||
    state === "recording" ||
    state === "finishing" ||
    state === "cancelling";
  const actionBusy = pending || state === "finishing" || state === "cancelling";

  return (
    <View style={styles.root} testID="v2-global-voice-controls">
      {active ? (
        <View style={styles.captureStatus}>
          <VoiceLevelMeter level={level} />
          <ShimmerText style={styles.status} text={statusLabel(state, message)} />
        </View>
      ) : message === null ? null : (
        <ProductText
          accessibilityLiveRegion={state === "error" ? "assertive" : "polite"}
          style={styles.status}
          tone={state === "error" ? "danger" : "muted"}
        >
          {message}
        </ProductText>
      )}

      <View style={styles.actions}>
        {state === "recording" ? (
          <VoiceAction
            icon="stop"
            label="Finish voice input"
            onPress={finish}
            pending={actionBusy}
            tone="primary"
          />
        ) : null}
        {state === "retry" ? (
          <VoiceAction
            icon="refresh"
            label="Retry voice transcription"
            onPress={retry}
            pending={actionBusy}
            tone="primary"
          />
        ) : null}
        {active || state === "retry" ? (
          <VoiceAction
            icon="close"
            label="Cancel voice input"
            onPress={cancel}
            pending={state === "cancelling" || pending}
            tone="secondary"
          />
        ) : (
          <VoiceAction
            disabled={disabled}
            icon={state === "error" ? "refresh" : "mic"}
            label={state === "error" ? "Try voice input again" : "Start voice input"}
            onPress={start}
            pending={pending}
            tone="secondary"
          />
        )}
      </View>
    </View>
  );
}

interface VoiceActionProps {
  disabled?: boolean;
  icon: "close" | "mic" | "refresh" | "stop";
  label: string;
  onPress(): void;
  pending: boolean;
  tone: "primary" | "secondary";
}

function VoiceAction(props: VoiceActionProps): React.JSX.Element {
  const { disabled = false, icon, label, onPress, pending, tone } = props;
  const unavailable = disabled || pending;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={[
        styles.action,
        tone === "primary" ? styles.primaryAction : styles.secondaryAction,
        unavailable && styles.disabled,
      ]}
    >
      <PresentationIcon
        color={tone === "primary" ? colors.onPrimary : colors.text}
        name={icon}
        size={20}
      />
      <ProductText
        style={[styles.actionLabel, tone === "primary" && styles.primaryActionLabel]}
        tone={tone === "primary" ? "default" : "muted"}
      >
        {label}
      </ProductText>
    </Pressable>
  );
}

function statusLabel(state: VoiceCaptureState, message: string | null): string {
  if (message !== null) return message;
  if (state === "starting") return "Starting voice…";
  if (state === "finishing") return "Finishing voice…";
  if (state === "cancelling") return "Cancelling voice…";
  return "Listening…";
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  actionLabel: typeScale.label,
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  captureStatus: { alignItems: "stretch", gap: spacing.xs },
  disabled: { opacity: 0.45 },
  primaryAction: { backgroundColor: colors.primary },
  primaryActionLabel: { color: colors.onPrimary },
  root: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  secondaryAction: { backgroundColor: colors.surfaceContainerHigh },
  status: typeScale.label,
});
