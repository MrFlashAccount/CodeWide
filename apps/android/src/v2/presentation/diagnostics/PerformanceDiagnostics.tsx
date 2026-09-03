import { StyleSheet, Switch, View } from "react-native";

import type {
  PerformanceDiagnosticsSnapshot,
  PerformanceExperimentId,
} from "../../features/diagnostics/diagnosticsTypes";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { DiagnosticButton } from "./DiagnosticButton";
import { OperationalMetricsView } from "./OperationalMetricsView";
import { PerformanceExperimentList } from "./PerformanceExperimentList";
import { PerformanceMetricGrid } from "./PerformanceMetricGrid";

export interface PerformanceDiagnosticsProps {
  copied: boolean;
  error: string | null;
  onCopy(): void;
  onExperimentChange(id: PerformanceExperimentId, enabled: boolean): void;
  onMonitoringChange(enabled: boolean): void;
  onReset(): void;
  onRunExperiment(id: PerformanceExperimentId): void;
  pending: boolean;
  runningExperiment: PerformanceExperimentId | null;
  snapshot: PerformanceDiagnosticsSnapshot;
}

export function PerformanceDiagnostics(props: PerformanceDiagnosticsProps): React.JSX.Element {
  const { snapshot } = props;
  return (
    <View style={styles.root}>
      <View style={styles.toggleRow}>
        <PresentationIcon color={colors.text} name="analytics" size={typeScale.heading.fontSize} />
        <View style={styles.grow}>
          <ProductText weight="semibold">Data for geeks</ProductText>
          <ProductText tone="muted">
            Native process, frame pacing, and network telemetry
          </ProductText>
        </View>
        <Switch
          accessibilityLabel="Enable performance data"
          disabled={!snapshot.native.available || props.pending}
          onValueChange={props.onMonitoringChange}
          value={snapshot.native.enabled}
        />
      </View>
      {!snapshot.native.available ? (
        <ProductText tone="muted">Available in the Android app.</ProductText>
      ) : null}
      {props.error === null ? null : (
        <ProductText accessibilityRole="alert" selectable tone="danger">
          {props.error}
        </ProductText>
      )}
      {snapshot.native.enabled ? (
        <>
          <PerformanceMetricGrid metrics={snapshot.native} />
          <View style={styles.actions}>
            <DiagnosticButton
              label={props.copied ? "Copied" : "Copy snapshot"}
              onPress={props.onCopy}
              pending={props.pending}
            />
            <DiagnosticButton label="Reset JS metrics" onPress={props.onReset} pending={false} />
          </View>
          <View style={styles.card}>
            <ProductText weight="semibold">Session experiments</ProductText>
            <ProductText tone="dim">
              Temporary A/B switches; transport and projection remain active.
            </ProductText>
            <PerformanceExperimentList
              enabled={snapshot.experiments}
              onChange={props.onExperimentChange}
              onRun={props.onRunExperiment}
              runningExperiment={props.runningExperiment}
            />
          </View>
          <OperationalMetricsView metrics={snapshot.operational} />
          <ProductText style={styles.footnote} tone="dim">
            Collection remains bounded to the app process. CPU is aggregate across cores; Android
            does not expose trustworthy per-app GPU or energy usage.
          </ProductText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  footnote: { ...typeScale.caption },
  grow: { flex: 1, minWidth: 0 },
  root: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
  },
});
