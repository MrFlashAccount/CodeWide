import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import { setPerformanceMonitoringEnabled, usePerformanceMetrics, type PerformanceMetricPoint } from "../native/performance-metrics";
import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

export function PerformanceDiagnostics() {
  const metrics = usePerformanceMetrics();
  const [error, setError] = useState<string | null>(null);
  const current = metrics.current;
  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      await setPerformanceMonitoringEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change performance monitoring");
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.toggleRow}>
        <View style={styles.iconShell}>
          <Ionicons name="pulse-outline" size={20} color={colors.text} />
        </View>
        <View style={styles.toggleCopy}>
          <Text style={styles.title}>Data for geeks</Text>
          <Text style={styles.subtitle}>Native process, frame pacing and network telemetry</Text>
        </View>
        <Switch
          accessibilityLabel="Enable performance data"
          disabled={!metrics.available}
          value={metrics.enabled}
          onValueChange={(enabled) => void toggle(enabled)}
        />
      </View>

      {!metrics.available && <Text style={styles.notice}>Available in the Android app.</Text>}
      {error !== null && <Text selectable style={styles.error}>{error}</Text>}
      {metrics.enabled && current === null && (
        <View style={styles.collecting}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.notice}>Collecting the first native sample…</Text>
        </View>
      )}
      {metrics.enabled && current !== null && (
        <>
          <View style={styles.grid}>
            <MetricTile label="Process CPU" value={percent(current.cpuPercent)} detail={`peak ${percent(metrics.peakCpuPercent)}`} />
            <MetricTile label="Memory PSS" value={bytes(current.pssBytes)} detail={`peak ${bytes(metrics.peakPssBytes)}`} />
            <MetricTile label="Rendered FPS" value={decimal(current.renderedFps)} detail={`${current.renderedFrames} frames / sample`} />
            <MetricTile label="Frame p95" value={`${decimal(current.p95FrameMs)} ms`} detail={`avg ${decimal(current.averageFrameMs)} ms`} />
            <MetricTile label="Jank" value={percent(current.jankPercent)} detail={`session ${percent(metrics.sessionJankPercent)}`} />
            <MetricTile label="Missed estimate" value={integer(current.droppedFrameEstimate)} detail={`session ${integer(metrics.totalDroppedFrameEstimate)}`} />
            <MetricTile label="Download" value={rate(current.rxBytesPerSecond)} detail={`session ${bytesOrUnavailable(current.rxSessionBytes)}`} />
            <MetricTile label="Upload" value={rate(current.txBytesPerSecond)} detail={`session ${bytesOrUnavailable(current.txSessionBytes)}`} />
          </View>

          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={styles.chartTitle}>Last 60 seconds</Text>
                <Text style={styles.chartSubtitle}>{duration(current.uptimeMs)} session · {metrics.historySamples}/{metrics.historyCapacity} native samples</Text>
              </View>
              <View style={styles.legend}>
                <Legend color={colors.green} label="CPU" />
                <Legend color={colors.amber} label="frame p95" />
              </View>
            </View>
            <PerformanceSparkline points={metrics.recent} />
          </View>

          <View style={styles.memoryRow}>
            <Text style={styles.memoryLabel}>RSS {bytes(current.rssBytes)}</Text>
            <Text style={styles.memoryLabel}>Java {bytes(current.javaHeapBytes)} / {bytes(current.javaHeapLimitBytes)}</Text>
            <Text style={styles.memoryLabel}>Native heap {bytes(current.nativeHeapBytes)}</Text>
          </View>
          <Text style={styles.footnote}>
            Collection continues while the app process lives; one-second samples stay in a bounded one-hour native ring buffer. CPU is aggregate across cores; network values cover the app UID. Stock Android does not expose trustworthy per-app GPU or energy usage, so those are intentionally omitted.
          </Text>
        </>
      )}
    </View>
  );
}

function MetricTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function PerformanceSparkline({ points }: { points: PerformanceMetricPoint[] }) {
  const width = 300;
  const height = 62;
  const cpuPoints = linePoints(points.map((point) => point.cpuPercent), width, height, 0, 100);
  const frameCeiling = Math.max(33, ...points.map((point) => point.p95FrameMs));
  const framePoints = linePoints(points.map((point) => point.p95FrameMs), width, height, 0, frameCeiling);
  return (
    <View style={styles.sparkline}>
      {points.length < 2 ? (
        <Text style={styles.chartEmpty}>Waiting for history…</Text>
      ) : (
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <Polyline points={cpuPoints} fill="none" stroke={colors.green} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <Polyline points={framePoints} fill="none" stroke={colors.amber} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </Svg>
      )}
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function linePoints(values: number[], width: number, height: number, floor: number, ceiling: number): string {
  if (values.length === 0) return "";
  const span = Math.max(1, ceiling - floor);
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  return values.map((value, index) => {
    const normalized = Math.max(0, Math.min(1, (value - floor) / span));
    return `${(index * xStep).toFixed(2)},${(height - normalized * height).toFixed(2)}`;
  }).join(" ");
}

const decimalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function decimal(value: number): string { return decimalFormat.format(value); }
function integer(value: number): string { return integerFormat.format(value); }
function percent(value: number): string { return `${decimal(value)}%`; }

function bytes(value: number): string {
  if (value < 1_024) return `${integer(value)} B`;
  if (value < 1_048_576) return `${decimal(value / 1_024)} KB`;
  if (value < 1_073_741_824) return `${decimal(value / 1_048_576)} MB`;
  return `${decimal(value / 1_073_741_824)} GB`;
}

function bytesOrUnavailable(value: number): string { return value < 0 ? "unavailable" : bytes(value); }
function rate(value: number): string { return value < 0 ? "unavailable" : `${bytes(value)}/s`; }

function duration(valueMs: number): string {
  const totalSeconds = Math.floor(valueMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  toggleRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconShell: { width: 40, height: 40, borderRadius: radii.medium, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised },
  toggleCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.titleMedium },
  subtitle: { marginTop: 2, color: colors.textMuted, ...typeScale.labelMedium },
  notice: { color: colors.textMuted, ...typeScale.bodyMedium },
  error: { color: colors.red, ...typeScale.bodyMedium },
  collecting: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  metricTile: { width: "48%", flexGrow: 1, minWidth: 130, padding: spacing.sm, gap: 2, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  metricLabel: { color: colors.textMuted, ...typeScale.labelMedium },
  metricValue: { color: colors.text, fontSize: 22, lineHeight: 28, fontWeight: "600", fontVariant: ["tabular-nums"] },
  metricDetail: { color: colors.textDim, fontSize: 11, lineHeight: 15, fontVariant: ["tabular-nums"] },
  chartCard: { padding: spacing.sm, gap: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  chartHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  chartTitle: { color: colors.text, ...typeScale.titleMedium },
  chartSubtitle: { marginTop: 2, color: colors.textDim, fontSize: 10, lineHeight: 14 },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  sparkline: { height: 62, overflow: "hidden" },
  chartEmpty: { color: colors.textDim, ...typeScale.labelMedium },
  memoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  memoryLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontVariant: ["tabular-nums"] },
  footnote: { color: colors.textDim, fontSize: 10, lineHeight: 15 },
});
