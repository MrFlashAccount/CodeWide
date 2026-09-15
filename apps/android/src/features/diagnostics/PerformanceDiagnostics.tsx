import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Switch, View } from "react-native";
import { memoryReclamationExperimentAvailable } from "../../native/performance-metrics";
import { colors, iconSize } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PerformanceDiagnostics.styles";
import { usePerformanceDiagnosticsState } from "./performanceDiagnosticsState";
import { renderPerformanceSampleDetails } from "./PerformanceSampleDetails";

export function PerformanceDiagnostics() {
  const state = usePerformanceDiagnosticsState();
  return (
    <View style={styles.section}>
      <View style={styles.toggleRow}>
        <View style={styles.iconShell}>
          <Ionicons name="pulse-outline" size={iconSize.action} color={colors.text} />
        </View>
        <View style={styles.toggleCopy}>
          <Text style={styles.title}>Data for geeks</Text>
          <Text style={styles.subtitle}>Native process, frame pacing and network telemetry</Text>
        </View>
        <Switch
          accessibilityLabel="Enable performance data"
          disabled={!state.metrics.available}
          value={state.metrics.enabled}
          onValueChange={(enabled) => void state.toggle(enabled)}
        />
      </View>

      {!state.metrics.available && <Text style={styles.notice}>Available in the Android app.</Text>}
      {state.metrics.available && (
        <View style={styles.diagnosticsButtonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy scroll report"
            disabled={state.copyPending}
            onPress={() => void state.copySnapshot()}
            style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
          >
            <Text style={styles.smallButtonText}>
              {state.copyPending
                ? "Collecting…"
                : state.snapshotCopied
                  ? "Copied"
                  : "Copy scroll report"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy memory report"
            disabled={state.memoryReportCopyState === "collecting"}
            onPress={() => void state.copyMemoryReport()}
            style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
          >
            <Text style={styles.smallButtonText}>
              {state.memoryReportCopyState === "collecting"
                ? "Collecting…"
                : state.memoryReportCopyState === "copied"
                  ? "Copied"
                  : "Copy memory report"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run memory reclamation experiment"
            disabled={
              !memoryReclamationExperimentAvailable() || state.memoryExperimentState === "running"
            }
            onPress={() => void state.runMemoryExperiment()}
            style={({ pressed }) => [
              styles.smallButton,
              (!memoryReclamationExperimentAvailable() ||
                state.memoryExperimentState === "running") &&
                styles.buttonDisabled,
              pressed && styles.smallButtonPressed,
            ]}
          >
            <Text style={styles.smallButtonText}>
              {state.memoryExperimentState === "running"
                ? "Reclaiming…"
                : state.memoryExperimentState === "copied"
                  ? "Copied"
                  : "Run reclaim test"}
            </Text>
          </Pressable>
        </View>
      )}
      {state.metrics.available && (
        <Text style={styles.chartSubtitle}>
          The reclaim test evicts render caches once and copies every stage to the clipboard.
        </Text>
      )}
      {state.error !== null && (
        <Text selectable style={styles.error}>
          {state.error}
        </Text>
      )}
      {state.metrics.enabled && state.current === null && (
        <View style={styles.collecting}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.notice}>Collecting the first native sample…</Text>
        </View>
      )}
      {state.metrics.enabled &&
        state.current !== null &&
        renderPerformanceSampleDetails(state, state.current)}
    </View>
  );
}
