import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { spacing, typeWeight } from "../../theme";

export type VoiceCaptureState = "idle" | "starting" | "recording" | "finishing" | "retry" | "error";

interface VoiceCaptureControlsProps {
  disabled: boolean;
  message: string | null;
  onCancel(): Promise<void>;
  onFailure(): void;
  onFinish(): Promise<void>;
  onStart(): Promise<void>;
  state: VoiceCaptureState;
}

/** Protocol-neutral Voice controls; callers own audio, authority, and transcript state. */
export function VoiceCaptureControls(props: VoiceCaptureControlsProps): React.JSX.Element {
  const { disabled, message, onCancel, onFailure, onFinish, onStart, state } = props;
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
  const start = useEvent(() => run(onStart));
  const recording = state === "recording" || state === "finishing";
  return (
    <View style={styles.root}>
      {recording ? (
        <>
          <Pressable
            accessibilityLabel="Finish V2 voice input"
            accessibilityRole="button"
            accessibilityState={{ busy: pending || state === "finishing", disabled: pending }}
            disabled={pending}
            onPress={finish}
            style={styles.finish}
          >
            <Text style={styles.label}>
              {state === "finishing" ? "Finishing voice…" : "Finish voice"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Cancel V2 voice input"
            accessibilityRole="button"
            accessibilityState={{ busy: pending, disabled: pending }}
            disabled={pending}
            onPress={cancel}
            style={styles.cancel}
          >
            <Text style={styles.label}>Cancel voice</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityLabel="Start V2 voice input"
          accessibilityRole="button"
          accessibilityState={{
            busy: pending || state === "starting",
            disabled: disabled || pending,
          }}
          disabled={disabled || pending}
          onPress={start}
          style={[styles.start, (disabled || pending) && styles.disabled]}
        >
          <Text style={styles.label}>
            {state === "starting" ? "Starting voice…" : "Voice input"}
          </Text>
        </Pressable>
      )}
      {message === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={state === "error" ? styles.error : styles.status}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  cancel: {
    backgroundColor: "#3f3f46",
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  error: { color: "#ff8b8b" },
  finish: {
    backgroundColor: "#0369a1",
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: { color: "#fafafa", fontWeight: typeWeight.semibold },
  root: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  start: {
    backgroundColor: "#14532d",
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  status: { color: "#e4e4e7", flexBasis: "100%" },
});
