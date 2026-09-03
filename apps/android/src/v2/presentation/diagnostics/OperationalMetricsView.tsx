import { StyleSheet, View } from "react-native";

import { diagnosticDecimal, diagnosticInteger } from "../../features/diagnostics/diagnosticFormat";
import type { OperationalMetricsSnapshot } from "../../features/diagnostics/diagnosticsTypes";
import { colors, radii, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";

interface OperationalMetricsViewProps {
  metrics: OperationalMetricsSnapshot;
}

interface MetricRowProps {
  label: string;
  value: string;
}

interface MetricValueProps {
  label: string;
  value: number | undefined;
}

export function OperationalMetricsView(props: OperationalMetricsViewProps): React.JSX.Element {
  const { metrics } = props;
  const timings = Object.entries(metrics.timings).filter((entry) => entry[1] !== undefined);
  const counters = Object.entries(metrics.counters).filter((entry) => entry[1] !== undefined);
  const gauges = Object.entries(metrics.gauges).filter((entry) => entry[1] !== undefined);
  return (
    <View style={styles.card}>
      <ProductText weight="semibold">JS hot paths</ProductText>
      {timings.length === 0 ? (
        <ProductText tone="muted">Waiting for instrumented work…</ProductText>
      ) : (
        timings.map((entry) => {
          const [name, timing] = entry;
          if (timing === undefined) return null;
          return (
            <MetricRow
              key={name}
              label={readableName(name)}
              value={`${diagnosticDecimal(timing.totalMs)} ms · ${diagnosticInteger(timing.totalCount)} calls · p95 ${diagnosticDecimal(timing.p95Ms)} ms`}
            />
          );
        })
      )}
      <View style={styles.values}>
        {counters.map(renderMetricValue)}
        {gauges.map(renderMetricValue)}
      </View>
    </View>
  );
}

function MetricRow(props: MetricRowProps): React.JSX.Element {
  const { label, value } = props;
  return (
    <View style={styles.row}>
      <ProductText style={styles.label} tone="muted">
        {label}
      </ProductText>
      <ProductText style={styles.value}>{value}</ProductText>
    </View>
  );
}

function MetricValue(props: MetricValueProps): React.JSX.Element {
  const { label, value } = props;
  return (
    <ProductText style={styles.compact} tone="dim">
      {readableName(label)} {diagnosticInteger(value ?? 0)}
    </ProductText>
  );
}

function renderMetricValue(entry: [string, number | undefined]): React.JSX.Element {
  const [name, value] = entry;
  return <MetricValue key={name} label={name} value={value} />;
}

function readableName(value: string): string {
  return value.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  compact: { ...typeScale.caption },
  label: { flex: 1, ...typeScale.label },
  row: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  value: { flexShrink: 0, fontVariant: ["tabular-nums"], ...typeScale.caption },
  values: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
