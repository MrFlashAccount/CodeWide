import { useSelector } from "@legendapp/state/react";
import type { ReactElement } from "react";
import { Pressable, Switch, View } from "react-native";

import { windowDiagnosticResource } from "../../data/windowDiagnostics";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PerformanceDiagnostics.styles";
import { useWindowDiagnosticActions } from "./useWindowDiagnosticActions";

/** Opt-in window geometry recording and explicit clipboard export, without rendering fixes. */
export function WindowDiagnostics(): ReactElement {
  const resource = windowDiagnosticResource();
  const state = useSelector(() => resource.get().value);
  const actions = useWindowDiagnosticActions();
  if (state.status === "unavailable") {
    return <Text style={styles.notice}>Window diagnostics requires an updated Android app.</Text>;
  }
  if (state.status === "load-error") {
    return <Text style={styles.error}>{state.message}</Text>;
  }
  const busy =
    state.status === "loading" || state.status === "changing" || actions.copyState === "copying";
  const recording = state.status === "loading" ? false : state.recording;
  return (
    <View style={styles.chartCard}>
      <WindowDiagnosticToggle busy={busy} onChange={actions.toggle} recording={recording} />
      <Text style={styles.chartSubtitle}>
        Record window sizes and display scaling while you resize or unfold. Recording continues
        outside settings until turned off or the app closes. The last 160 samples stay available
        after stopping; turning on starts a new report. Chat content is not recorded. The report
        also includes the last 80 sidebar layout and navigation events from this app session,
        collected independently of this switch. Nothing is uploaded automatically.
      </Text>
      <WindowReportButton busy={busy} copy={actions.copy} copyState={actions.copyState} />
      {state.status === "error" && <Text style={styles.error}>{state.message}</Text>}
      {actions.copyState === "error" && (
        <Text style={styles.error}>Could not copy the window report. Try again.</Text>
      )}
    </View>
  );
}

function WindowDiagnosticToggle({
  busy,
  onChange,
  recording,
}: {
  readonly busy: boolean;
  readonly onChange: (enabled: boolean) => Promise<void>;
  readonly recording: boolean;
}): ReactElement {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.title, styles.toggleCopy]}>Window diagnostics</Text>
      <Switch
        accessibilityLabel="Record window diagnostics"
        accessibilityRole="switch"
        accessibilityState={{ checked: recording }}
        accessible
        disabled={busy}
        onValueChange={onChange}
        value={recording}
      />
    </View>
  );
}

function WindowReportButton({
  busy,
  copy,
  copyState,
}: {
  readonly busy: boolean;
  readonly copy: () => void;
  readonly copyState: ReturnType<typeof useWindowDiagnosticActions>["copyState"];
}): ReactElement {
  const label =
    copyState === "copying"
      ? "Collecting…"
      : copyState === "copied"
        ? "Copied"
        : "Copy window report";
  return (
    <Pressable
      accessibilityLabel="Copy window report"
      accessibilityRole="button"
      disabled={busy}
      onPress={copy}
      style={({ pressed }) => [
        styles.smallButton,
        busy && styles.buttonDisabled,
        pressed && styles.smallButtonPressed,
      ]}
    >
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}
