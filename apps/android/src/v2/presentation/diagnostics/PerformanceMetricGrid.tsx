import { StyleSheet, View } from "react-native";

import {
  diagnosticBytes,
  diagnosticDecimal,
  diagnosticInteger,
  diagnosticPercent,
  diagnosticRate,
} from "../../features/diagnostics/diagnosticFormat";
import type {
  CurrentPerformanceMetrics,
  PerformanceMetricsSnapshot,
} from "../../features/diagnostics/diagnosticsTypes";
import { colors, radii, spacing, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { PerformanceSparkline } from "./PerformanceSparkline";

interface PerformanceMetricGridProps {
  metrics: PerformanceMetricsSnapshot;
}

interface MetricTileProps {
  detail: string;
  label: string;
  value: string;
}

interface MemoryBreakdownProps {
  current: CurrentPerformanceMetrics;
}

export function PerformanceMetricGrid(props: PerformanceMetricGridProps): React.JSX.Element {
  const { metrics } = props;
  const { current } = metrics;
  if (current === null)
    return <ProductText tone="muted">Collecting the first native sample…</ProductText>;
  return (
    <>
      <View style={styles.grid}>
        <MetricTile
          detail={`peak ${diagnosticPercent(metrics.peakCpuPercent)}`}
          label="Process CPU"
          value={diagnosticPercent(current.cpuPercent)}
        />
        <MetricTile
          detail={`peak ${diagnosticBytes(metrics.peakPssBytes)}`}
          label="Memory PSS"
          value={diagnosticBytes(current.pssBytes)}
        />
        <MetricTile
          detail={`${String(current.renderedFrames)} frames / sample`}
          label="Rendered FPS"
          value={diagnosticDecimal(current.renderedFps)}
        />
        <MetricTile
          detail={`avg ${diagnosticDecimal(current.averageFrameMs)} ms`}
          label="Frame p95"
          value={`${diagnosticDecimal(current.p95FrameMs)} ms`}
        />
        <MetricTile
          detail={`session ${diagnosticPercent(metrics.sessionJankPercent)}`}
          label="Jank"
          value={diagnosticPercent(current.jankPercent)}
        />
        <MetricTile
          detail={`session ${diagnosticInteger(metrics.totalDroppedFrameEstimate)}`}
          label="Missed estimate"
          value={diagnosticInteger(current.droppedFrameEstimate)}
        />
        <MetricTile
          detail={`session ${diagnosticBytes(current.rxSessionBytes)}`}
          label="Download"
          value={diagnosticRate(current.rxBytesPerSecond)}
        />
        <MetricTile
          detail={`session ${diagnosticBytes(current.txSessionBytes)}`}
          label="Upload"
          value={diagnosticRate(current.txBytesPerSecond)}
        />
      </View>
      <View style={styles.chartCard}>
        <ProductText weight="semibold">Recent native samples</ProductText>
        <PerformanceSparkline points={metrics.recent} />
      </View>
      <MemoryBreakdown current={current} />
    </>
  );
}

function MetricTile(props: MetricTileProps): React.JSX.Element {
  const { detail, label, value } = props;
  return (
    <View style={styles.metricTile}>
      <ProductText style={styles.metricLabel} tone="muted">
        {label}
      </ProductText>
      <ProductText
        adjustsFontSizeToFit
        numberOfLines={1}
        style={styles.metricValue}
        weight="semibold"
      >
        {value}
      </ProductText>
      <ProductText numberOfLines={1} style={styles.detail} tone="dim">
        {detail}
      </ProductText>
    </View>
  );
}

function MemoryBreakdown(props: MemoryBreakdownProps): React.JSX.Element {
  const { current } = props;
  return (
    <View style={styles.memory}>
      <ProductText weight="semibold">Memory</ProductText>
      <ProductText tone="muted">
        RSS {diagnosticBytes(current.rssBytes)} · Java {diagnosticBytes(current.javaHeapBytes)} /{" "}
        {diagnosticBytes(current.javaHeapLimitBytes)}
      </ProductText>
      <ProductText tone="muted">
        Native heap {diagnosticBytes(current.nativeHeapBytes)} · Graphics{" "}
        {diagnosticBytes(current.graphicsPssBytes)} · Code {diagnosticBytes(current.codePssBytes)}
      </ProductText>
    </View>
  );
}

const styles = StyleSheet.create({
  chartCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  detail: { ...typeScale.caption },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  memory: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  metricLabel: { ...typeScale.label },
  metricTile: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    flexGrow: 1,
    gap: spacing.optical,
    minWidth: 130,
    padding: spacing.sm,
    width: "48%",
  },
  metricValue: { ...typeScale.heading, fontVariant: ["tabular-nums"] },
});
