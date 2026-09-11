import { Ionicons } from "@expo/vector-icons";
import { resetRichMarkdownCache, richMarkdownCacheEstimatedBytes, richMarkdownCacheStats } from "@codewide/rendering-core";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

import {
  captureMemoryCheckpoint,
  captureMemoryReport,
  clearImageMemoryCache,
  clearNativeCodeMemoryCache,
  collectHermesGarbage,
  collectJavaGarbage,
  getPerformanceMetricsSnapshot,
  getWindowFrameReport,
  memoryReclamationExperimentAvailable,
  purgeNativeAllocator,
  setPerformanceMonitoringEnabled,
  usePerformanceMetrics,
  type MemoryCheckpoint,
  type MemoryReclamationActionResult,
  type PerformanceMetricPoint,
} from "../native/performance-metrics";
import {
  operationalMetricsSnapshot,
  resetOperationalMetrics,
  type OperationalMetricsSnapshot,
  type TimingMetric,
} from "../data/operational-metrics";
import {
  performanceExperimentSnapshot,
  setPerformanceExperiment,
  usePerformanceExperiments,
  type PerformanceExperimentId,
} from "../data/performance-experiments";
import { colors, radii, spacing, typeScale, typeWeight, iconSize, layoutSize, controlSize } from "../theme";
import { useEvent } from "../react/useEvent";
import { AppText as Text } from "./Typography";

export function PerformanceDiagnostics() {
  const metrics = usePerformanceMetrics();
  const experiments = usePerformanceExperiments();
  const [error, setError] = useState<string | null>(null);
  const [, setDiagnosticRevision] = useState(0);
  const [runningExperiment, setRunningExperiment] = useState<PerformanceExperimentId | null>(null);
  const [experimentResult, setExperimentResult] = useState<ExperimentResult | null>(null);
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const [memoryReportCopyState, setMemoryReportCopyState] = useState<"idle" | "collecting" | "copied">("idle");
  const [memoryExperimentState, setMemoryExperimentState] = useState<"idle" | "running" | "copied">("idle");
  const copyInFlight = useRef(false);
  const memoryReportInFlight = useRef(false);
  const memoryExperimentInFlight = useRef(false);
  const runGeneration = useRef(0);
  const runningRestore = useRef<{ id: PerformanceExperimentId; enabled: boolean } | null>(null);
  const current = metrics.current;
  useEffect(() => {
    if (!metrics.enabled) return;
    const timer = setInterval(() => setDiagnosticRevision((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [metrics.enabled]);
  useEffect(() => () => {
    runGeneration.current += 1;
    const restore = runningRestore.current;
    if (restore !== null) setPerformanceExperiment(restore.id, restore.enabled);
  }, []);
  const operational = operationalMetricsSnapshot();
  const resetMemoryReportCopyState = useEvent(() => setMemoryReportCopyState("idle"));
  const resetMemoryExperimentState = useEvent(() => setMemoryExperimentState("idle"));
  const toggle = async (enabled: boolean) => {
    setError(null);
    if (!enabled && runningRestore.current !== null) {
      runGeneration.current += 1;
      setPerformanceExperiment(runningRestore.current.id, runningRestore.current.enabled);
      runningRestore.current = null;
      setRunningExperiment(null);
    }
    try {
      await setPerformanceMonitoringEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change performance monitoring");
    }
  };
  const runExperiment = async (id: PerformanceExperimentId) => {
    if (runningExperiment !== null) return;
    const generation = runGeneration.current + 1;
    runGeneration.current = generation;
    const previous = performanceExperimentSnapshot()[id];
    runningRestore.current = { id, enabled: previous };
    setRunningExperiment(id);
    setExperimentResult(null);
    setError(null);
    const outcome = await collectExperiment(id, () => runGeneration.current === generation).then(
      (result) => ({ result, error: null }),
      (cause: unknown) => ({ result: null, error: cause instanceof Error ? cause.message : "Performance experiment failed" }),
    );
    if (runGeneration.current !== generation) return;
    if (outcome.error !== null) setError(outcome.error);
    else if (outcome.result !== null) setExperimentResult(outcome.result);
    if (runGeneration.current === generation) {
      setPerformanceExperiment(id, previous);
      runningRestore.current = null;
      setRunningExperiment(null);
    }
  };
  const copySnapshot = async () => {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    setCopyPending(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(JSON.stringify({
        version: 1,
        collectedAt: new Date().toISOString(),
        native: {
          available: metrics.available,
          enabled: metrics.enabled,
          current: metrics.current,
          peakCpuPercent: metrics.peakCpuPercent,
          peakPssBytes: metrics.peakPssBytes,
          sessionJankPercent: metrics.sessionJankPercent,
          totalDroppedFrameEstimate: metrics.totalDroppedFrameEstimate,
          historySamples: metrics.historySamples,
          historyCapacity: metrics.historyCapacity,
        },
        streaming: operationalMetricsSnapshot(),
        experiments: performanceExperimentSnapshot(),
        frameReport: await getWindowFrameReport(),
      }, null, 2));
      setSnapshotCopied(true);
      setTimeout(() => setSnapshotCopied(false), 2_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy diagnostics");
    }
    // Both outcomes reach cleanup; React Compiler cannot lower a finally clause here.
    copyInFlight.current = false;
    setCopyPending(false);
  };
  const copyMemoryReport = async () => {
    if (memoryReportInFlight.current) return;
    memoryReportInFlight.current = true;
    setMemoryReportCopyState("collecting");
    setError(null);
    try {
      await Clipboard.setStringAsync(await captureMemoryReport());
      setMemoryReportCopyState("copied");
      setTimeout(resetMemoryReportCopyState, 2_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy memory report");
      setMemoryReportCopyState("idle");
    }
    memoryReportInFlight.current = false;
  };
  const runMemoryExperiment = async () => {
    if (memoryExperimentInFlight.current) return;
    memoryExperimentInFlight.current = true;
    setMemoryExperimentState("running");
    setError(null);
    try {
      const stages: MemoryReclamationStage[] = [];
      stages.push({ id: "baseline", action: null, checkpoint: await captureMemoryCheckpoint() });

      const markdownBefore = {
        ...richMarkdownCacheStats(),
        estimatedBytes: richMarkdownCacheEstimatedBytes(),
      };
      const markdownStartedAt = performance.now();
      resetRichMarkdownCache();
      const markdownDurationMs = performance.now() - markdownStartedAt;
      await delay(MEMORY_RECLAMATION_SETTLE_MS);
      stages.push({
        id: "markdown-cache",
        action: { performed: markdownBefore.entries > 0, durationMs: markdownDurationMs },
        checkpoint: await captureMemoryCheckpoint(),
      });
      stages.push(await collectMemoryReclamationStage("native-code-cache", clearNativeCodeMemoryCache));
      stages.push(await collectMemoryReclamationStage("fresco-image-cache", clearImageMemoryCache));
      stages.push(await collectMemoryReclamationStage("art-gc", collectJavaGarbage));
      stages.push(await collectMemoryReclamationStage("hermes-gc", collectHermesGarbage));
      stages.push(await collectMemoryReclamationStage("allocator-purge", () => purgeNativeAllocator(false)));
      const finalReclamationStage = await collectMemoryReclamationStage("allocator-purge-all", () =>
        purgeNativeAllocator(true),
      );
      stages.push(finalReclamationStage);

      const fullReportEncoded = await captureMemoryReport();
      const fullReport: unknown = JSON.parse(fullReportEncoded);
      await delay(MEMORY_RECLAMATION_SETTLE_MS);
      const afterFullReport = await captureMemoryCheckpoint();
      const beforeFullReport = finalReclamationStage.checkpoint;
      await Clipboard.setStringAsync(JSON.stringify({
        version: 1,
        collectedAtMs: Date.now(),
        settleMs: MEMORY_RECLAMATION_SETTLE_MS,
        markdownCacheBefore: markdownBefore,
        stages,
        stageDeltas: memoryStageDeltas(stages),
        fullReport,
        fullReportProbe: {
          before: beforeFullReport,
          after: afterFullReport,
          delta: memoryCheckpointDelta(afterFullReport, beforeFullReport),
        },
      }, null, 2));
      setMemoryExperimentState("copied");
      setTimeout(resetMemoryExperimentState, 2_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Memory experiment failed");
      setMemoryExperimentState("idle");
    }
    memoryExperimentInFlight.current = false;
  };
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
          disabled={!metrics.available}
          value={metrics.enabled}
          onValueChange={(enabled) => void toggle(enabled)}
        />
      </View>

      {!metrics.available && <Text style={styles.notice}>Available in the Android app.</Text>}
      {metrics.available && <View style={styles.diagnosticsButtonRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy scroll report"
          disabled={copyPending}
          onPress={() => void copySnapshot()}
          style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
        >
          <Text style={styles.smallButtonText}>{copyPending ? "Collecting…" : snapshotCopied ? "Copied" : "Copy scroll report"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy memory report"
          disabled={memoryReportCopyState === "collecting"}
          onPress={() => void copyMemoryReport()}
          style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
        >
          <Text style={styles.smallButtonText}>
            {memoryReportCopyState === "collecting" ? "Collecting…" : memoryReportCopyState === "copied" ? "Copied" : "Copy memory report"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run memory reclamation experiment"
          disabled={!memoryReclamationExperimentAvailable() || memoryExperimentState === "running"}
          onPress={() => void runMemoryExperiment()}
          style={({ pressed }) => [
            styles.smallButton,
            (!memoryReclamationExperimentAvailable() || memoryExperimentState === "running") && styles.buttonDisabled,
            pressed && styles.smallButtonPressed,
          ]}
        >
          <Text style={styles.smallButtonText}>
            {memoryExperimentState === "running" ? "Reclaiming…" : memoryExperimentState === "copied" ? "Copied" : "Run reclaim test"}
          </Text>
        </Pressable>
      </View>}
      {metrics.available && <Text style={styles.chartSubtitle}>The reclaim test evicts render caches once and copies every stage to the clipboard.</Text>}
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
          <View style={styles.memoryBreakdown}>
            <Text style={styles.chartSubtitle}>PSS breakdown</Text>
            <View style={styles.memoryRow}>
              <Text style={styles.memoryLabel}>Java {bytes(current.javaHeapPssBytes)}</Text>
              <Text style={styles.memoryLabel}>Native {bytes(current.nativeHeapPssBytes)}</Text>
              <Text style={styles.memoryLabel}>Graphics {bytes(current.graphicsPssBytes)}</Text>
              <Text style={styles.memoryLabel}>Code {bytes(current.codePssBytes)}</Text>
              <Text style={styles.memoryLabel}>Stack {bytes(current.stackPssBytes)}</Text>
              <Text style={styles.memoryLabel}>Other {bytes(current.privateOtherPssBytes)}</Text>
              <Text style={styles.memoryLabel}>System {bytes(current.systemPssBytes)}</Text>
            </View>
          </View>
          <View style={styles.experimentCard}>
            <View style={styles.experimentHeader}>
              <View style={styles.experimentHeaderCopy}>
                <Text style={styles.chartTitle}>Session experiments</Text>
                <Text style={styles.chartSubtitle}>Safe A/B switches. Nothing is persisted; transport, projection and ACK stay active.</Text>
              </View>
              <View style={styles.diagnosticActionRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void copySnapshot()}
                  disabled={copyPending}
                  style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
                >
                  <Text style={styles.smallButtonText}>{snapshotCopied ? "Copied" : "Copy snapshot"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    resetOperationalMetrics();
                    setExperimentResult(null);
                    setDiagnosticRevision((value) => value + 1);
                  }}
                  style={({ pressed }) => [styles.smallButton, pressed && styles.smallButtonPressed]}
                >
                  <Text style={styles.smallButtonText}>Reset data</Text>
                </Pressable>
              </View>
            </View>
            {EXPERIMENTS.map((experiment) => (
              <View key={experiment.id} style={styles.experimentRow}>
                <View style={styles.experimentCopy}>
                  <Text style={styles.experimentTitle}>{experiment.title}</Text>
                  <Text style={styles.experimentDescription}>{experiment.description}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={runningExperiment !== null}
                  onPress={() => void runExperiment(experiment.id)}
                  style={({ pressed }) => [styles.abButton, runningExperiment !== null && styles.buttonDisabled, pressed && styles.smallButtonPressed]}
                >
                  {runningExperiment === experiment.id
                    ? <ActivityIndicator size="small" color={colors.text} />
                    : <Text style={styles.abButtonText}>A/B 16s</Text>}
                </Pressable>
                <Switch
                  accessibilityLabel={experiment.title}
                  disabled={runningExperiment !== null}
                  value={experiments[experiment.id]}
                  onValueChange={(enabled) => setPerformanceExperiment(experiment.id, enabled)}
                />
              </View>
            ))}
          </View>

          <OperationalMetrics metrics={operational} />
          {experimentResult !== null && <ExperimentResultCard result={experimentResult} />}
          <Text style={styles.footnote}>
            Collection continues while the app process lives; one-second samples stay in a bounded one-hour native ring buffer. CPU is aggregate across cores; network values cover the app UID. Stock Android does not expose trustworthy per-app GPU or energy usage, so those are intentionally omitted.
          </Text>
        </>
      )}
    </View>
  );
}

const EXPERIMENT_PHASE_MS = 7_000;
const MEMORY_RECLAMATION_SETTLE_MS = 400;
const STAGE_METRICS: ReadonlyArray<{ id: TimingMetric; label: string }> = [
  { id: "live_event_ingress_ms", label: "Native callback → JS" },
  { id: "live_ingress_gap_ms", label: "Socket delta gap" },
  { id: "native_json_decode_ms", label: "JSON decode" },
  { id: "live_batch_wait_ms", label: "JS batch queue" },
  { id: "projection_apply_ms", label: "Projection total" },
  { id: "live_delta_to_commit_ms", label: "Projection → React commit" },
  { id: "thread_detail_projection_ms", label: "Detail projection" },
  { id: "thread_summary_projection_ms", label: "Summary projection" },
  { id: "sqlite_subset_load_ms", label: "SQLite subset load" },
  { id: "sqlite_checkpoint_ms", label: "SQLite checkpoint" },
  { id: "markdown_parse_ms", label: "Markdown parse" },
];
const EXPERIMENTS: ReadonlyArray<{ id: PerformanceExperimentId; title: string; description: string }> = [
  { id: "disableTextShimmer", title: "Disable text shimmer", description: "Isolate the native text shader without stopping other animations." },
  { id: "plainTextMarkdown", title: "Plain-text Markdown", description: "Bypass Markdown AST and rich renderers." },
  { id: "skipMarkdownLayout", title: "Skip Markdown layout parse", description: "Bypass the extra width-classification parse." },
  { id: "hideThreadLists", title: "Pause thread lists", description: "Replace both virtualized lists with a static placeholder." },
  { id: "reduceCustomMotion", title: "Disable custom animations", description: "Stop shimmer, custom spinners and voice aura animation." },
];

type ExperimentWindow = {
  cpuPercent: number;
  pssBytes: number;
  stages: Partial<Record<TimingMetric, number>>;
};

type MemoryReclamationStage = {
  id: string;
  action: MemoryReclamationActionResult | null;
  checkpoint: MemoryCheckpoint;
};

type MemoryCheckpointDelta = {
  totalPssBytes: number;
  procRssBytes: number | null;
  smapsPssBytes: number | null;
  javaUsedBytes: number;
  nativeAllocatedBytes: number;
  nativeCommittedBytes: number;
  nativeFreeBytes: number;
  javaHeapPssBytes: number;
  nativeHeapPssBytes: number;
  graphicsPssBytes: number;
  privateOtherPssBytes: number;
};

type ExperimentResult = {
  id: PerformanceExperimentId;
  baseline: ExperimentWindow;
  variant: ExperimentWindow;
};

function OperationalMetrics({ metrics }: { metrics: OperationalMetricsSnapshot }) {
  const visibleStages = STAGE_METRICS.filter(({ id }) => metrics.timings[id] !== undefined);
  const jsEvents = metrics.counters.js_sync_events ?? 0;
  const jsBatches = metrics.counters.js_sync_event_batches ?? 0;
  const renderCommits = metrics.counters.live_render_commits ?? 0;
  const renderedProjectionBatches = metrics.counters.live_render_projection_batches ?? 0;
  return (
    <View style={styles.experimentCard}>
      <Text style={styles.chartTitle}>JS hot paths</Text>
      <Text style={styles.chartSubtitle}>Aggregate wall time since reset. Samples retain the latest 256 values; totals never roll over.</Text>
      {visibleStages.length === 0 ? <Text style={styles.notice}>Waiting for instrumented work…</Text> : visibleStages.map(({ id, label }) => {
        const timing = metrics.timings[id];
        if (timing === undefined) return null;
        return (
          <View key={id} style={styles.stageRow}>
            <Text style={styles.stageLabel}>{label}</Text>
            <Text style={styles.stageValue}>{decimal(timing.totalMs)} ms · {integer(timing.totalCount)} calls · p95 {decimal(timing.p95Ms)} ms</Text>
          </View>
        );
      })}
      <View style={styles.counterWrap}>
        <Text style={styles.counterText}>socket deltas {integer(metrics.counters.live_ingress_events ?? 0)} / {integer(metrics.counters.live_ingress_chars ?? 0)} chars</Text>
        <Text style={styles.counterText}>projected deltas {integer(metrics.counters.live_events ?? 0)} / {integer(metrics.counters.live_projected_chars ?? 0)} chars</Text>
        <Text style={styles.counterText}>React commits {integer(renderCommits)} / {integer(metrics.counters.live_render_chars ?? 0)} chars</Text>
        <Text style={styles.counterText}>projection batches/commit {ratio(renderedProjectionBatches, renderCommits)}</Text>
        <Text style={styles.counterText}>JS events {integer(jsEvents)} / {integer(jsBatches)} batches ({ratio(jsEvents, jsBatches)} avg)</Text>
        <Text style={styles.counterText}>JS ingress events {integer(metrics.counters.js_sync_ingress_events ?? 0)}</Text>
        <Text style={styles.counterText}>pending render {integer(metrics.gauges.livePendingStreams)} streams / {integer(metrics.gauges.livePendingChars)} chars / {decimal(metrics.gauges.liveOldestPendingMs)} ms oldest</Text>
        <Text style={styles.counterText}>lifecycle flushes {integer(metrics.counters.live_immediate_flushes ?? 0)}</Text>
        <Text style={styles.counterText}>native fallback events {integer(metrics.counters.native_events ?? 0)} / {integer(metrics.counters.native_event_batches ?? 0)} batches</Text>
        <Text style={styles.counterText}>event bytes {bytes(metrics.counters.native_event_bytes ?? 0)}</Text>
        <Text style={styles.counterText}>MD chars {integer(metrics.counters.markdown_parse_chars ?? 0)}</Text>
        <Text style={styles.counterText}>row commits {integer(metrics.counters.thread_row_commits ?? 0)}</Text>
        <Text style={styles.counterText}>SQLite subset rows {integer(metrics.gauges.sqliteSubsetLastRows)} last / {integer(metrics.gauges.sqliteSubsetMaxRows)} max / {integer(metrics.counters.sqlite_subset_rows_loaded ?? 0)} total</Text>
        <Text style={styles.counterText}>thread detail resident rows {integer(metrics.gauges.threadDetailResidentRows)}</Text>
      </View>
    </View>
  );
}

function ExperimentResultCard({ result }: { result: ExperimentResult }) {
  const experiment = EXPERIMENTS.find(({ id }) => id === result.id);
  return (
    <View style={styles.resultCard}>
      <Text style={styles.chartTitle}>{experiment?.title ?? result.id} result</Text>
      <Text style={styles.resultHeadline}>
        CPU {percent(result.baseline.cpuPercent)} → {percent(result.variant.cpuPercent)} ({signed(result.variant.cpuPercent - result.baseline.cpuPercent)} pp)
      </Text>
      <Text style={styles.experimentDescription}>
        PSS {bytes(result.baseline.pssBytes)} → {bytes(result.variant.pssBytes)}
      </Text>
      {STAGE_METRICS.map(({ id, label }) => {
        const baseline = result.baseline.stages[id] ?? 0;
        const variant = result.variant.stages[id] ?? 0;
        if (baseline === 0 && variant === 0) return null;
        return <Text key={id} style={styles.experimentDescription}>{label}: {decimal(baseline)} → {decimal(variant)} ms/s</Text>;
      })}
      <Text style={styles.chartSubtitle}>Treat this as a lead, not proof: both 7-second windows need comparable incoming work.</Text>
    </View>
  );
}

function measureWindow(startedAtMs: number, before: OperationalMetricsSnapshot, after: OperationalMetricsSnapshot): ExperimentWindow {
  const points = getPerformanceMetricsSnapshot().recent.filter((point) => point.sampledAtMs > startedAtMs);
  const stages: Partial<Record<TimingMetric, number>> = {};
  for (const { id } of STAGE_METRICS) {
    const beforeTotal = before.timings[id]?.totalMs ?? 0;
    const afterTotal = after.timings[id]?.totalMs ?? 0;
    stages[id] = Math.max(0, afterTotal - beforeTotal) / (EXPERIMENT_PHASE_MS / 1_000);
  }
  return {
    cpuPercent: average(points.map((point) => point.cpuPercent)),
    pssBytes: average(points.map((point) => point.pssBytes)),
    stages,
  };
}

async function collectExperiment(id: PerformanceExperimentId, isCurrent: () => boolean): Promise<ExperimentResult | null> {
  setPerformanceExperiment(id, false);
  await delay(1_100);
  if (!isCurrent()) return null;
  const baselineStart = currentPerformanceSampleAt();
  const baselineOperational = operationalMetricsSnapshot();
  await delay(EXPERIMENT_PHASE_MS);
  if (!isCurrent()) return null;
  const baseline = measureWindow(baselineStart, baselineOperational, operationalMetricsSnapshot());

  setPerformanceExperiment(id, true);
  await delay(1_100);
  if (!isCurrent()) return null;
  const variantStart = currentPerformanceSampleAt();
  const variantOperational = operationalMetricsSnapshot();
  await delay(EXPERIMENT_PHASE_MS);
  if (!isCurrent()) return null;
  const variant = measureWindow(variantStart, variantOperational, operationalMetricsSnapshot());
  return { id, baseline, variant };
}

async function collectMemoryReclamationStage(
  id: string,
  action: () => Promise<MemoryReclamationActionResult>,
): Promise<MemoryReclamationStage> {
  const result = await action();
  await delay(MEMORY_RECLAMATION_SETTLE_MS);
  return { id, action: result, checkpoint: await captureMemoryCheckpoint() };
}

function memoryStageDeltas(stages: MemoryReclamationStage[]) {
  const baseline = stages[0]?.checkpoint;
  return stages.map((stage, index) => {
    const previous = stages[index - 1];
    return {
      id: stage.id,
      fromPrevious: previous === undefined ? null : memoryCheckpointDelta(stage.checkpoint, previous.checkpoint),
      fromBaseline: baseline === undefined ? null : memoryCheckpointDelta(stage.checkpoint, baseline),
    };
  });
}

function memoryCheckpointDelta(current: MemoryCheckpoint, previous: MemoryCheckpoint): MemoryCheckpointDelta {
  return {
    totalPssBytes: current.totalPssBytes - previous.totalPssBytes,
    procRssBytes: nullableDelta(current.procRssBytes, previous.procRssBytes),
    smapsPssBytes: nullableDelta(current.smapsPssBytes, previous.smapsPssBytes),
    javaUsedBytes: current.javaUsedBytes - previous.javaUsedBytes,
    nativeAllocatedBytes: current.nativeAllocatedBytes - previous.nativeAllocatedBytes,
    nativeCommittedBytes: current.nativeCommittedBytes - previous.nativeCommittedBytes,
    nativeFreeBytes: current.nativeFreeBytes - previous.nativeFreeBytes,
    javaHeapPssBytes: current.javaHeapPssBytes - previous.javaHeapPssBytes,
    nativeHeapPssBytes: current.nativeHeapPssBytes - previous.nativeHeapPssBytes,
    graphicsPssBytes: current.graphicsPssBytes - previous.graphicsPssBytes,
    privateOtherPssBytes: current.privateOtherPssBytes - previous.privateOtherPssBytes,
  };
}

function nullableDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

function currentPerformanceSampleAt(): number {
  const current = getPerformanceMetricsSnapshot().current;
  return current === null ? 0 : current.sampledAtMs;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${decimal(value)}`;
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
function ratio(numerator: number, denominator: number): string { return denominator === 0 ? "—" : decimal(numerator / denominator); }

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
  toggleRow: { minHeight: layoutSize.row, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconShell: { width: controlSize.regular, height: controlSize.regular, borderRadius: radii.medium, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised },
  toggleCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typeScale.title },
  subtitle: { marginTop: spacing.optical, color: colors.textMuted, ...typeScale.label },
  notice: { color: colors.textMuted, ...typeScale.body },
  error: { color: colors.red, ...typeScale.body },
  collecting: { minHeight: controlSize.touch, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  metricTile: { width: "48%", flexGrow: 1, minWidth: 130, padding: spacing.sm, gap: spacing.optical, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  metricLabel: { color: colors.textMuted, ...typeScale.label },
  metricValue: { color: colors.text, ...typeScale.heading, fontWeight: typeWeight.semibold, fontVariant: ["tabular-nums"] },
  metricDetail: { color: colors.textDim, ...typeScale.label, fontVariant: ["tabular-nums"] },
  chartCard: { padding: spacing.sm, gap: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  chartHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  chartTitle: { color: colors.text, ...typeScale.title },
  chartSubtitle: { marginTop: spacing.optical, color: colors.textDim, ...typeScale.caption, },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  legendDot: { width: 7, height: 7, borderRadius: radii.pill },
  legendLabel: { color: colors.textMuted, ...typeScale.caption, },
  sparkline: { height: layoutSize.row, overflow: "hidden" },
  chartEmpty: { color: colors.textDim, ...typeScale.label },
  memoryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  memoryBreakdown: { gap: spacing.xs },
  memoryLabel: { color: colors.textMuted, ...typeScale.label, fontVariant: ["tabular-nums"] },
  experimentCard: { padding: spacing.sm, gap: spacing.sm, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerLow },
  experimentHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  experimentHeaderCopy: { flex: 1, minWidth: 0 },
  diagnosticsButtonRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  diagnosticActionRow: { alignItems: "flex-end", gap: spacing.xs },
  experimentRow: { minHeight: layoutSize.row, flexDirection: "row", alignItems: "center", gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingTop: spacing.xs },
  experimentCopy: { flex: 1, minWidth: 0 },
  experimentTitle: { color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  experimentDescription: { color: colors.textMuted, ...typeScale.label, },
  smallButton: { minHeight: controlSize.compact, justifyContent: "center", paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.medium },
  smallButtonPressed: { opacity: 0.72 },
  smallButtonText: { color: colors.text, ...typeScale.label },
  abButton: { minWidth: controlSize.compact, minHeight: controlSize.compact, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xs, borderRadius: radii.medium, backgroundColor: colors.surfaceContainerHigh },
  abButtonText: { color: colors.text, ...typeScale.label, fontWeight: typeWeight.semibold },
  buttonDisabled: { opacity: 0.5 },
  stageRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  stageLabel: { flex: 1, color: colors.textMuted, ...typeScale.label },
  stageValue: { color: colors.text, ...typeScale.label, fontVariant: ["tabular-nums"] },
  counterWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  counterText: { color: colors.textDim, ...typeScale.caption, fontVariant: ["tabular-nums"] },
  resultCard: { padding: spacing.sm, gap: spacing.xs, borderRadius: radii.medium, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.surfaceContainerLow },
  resultHeadline: { color: colors.text, ...typeScale.heading, fontWeight: typeWeight.semibold, fontVariant: ["tabular-nums"] },
  footnote: { color: colors.textDim, ...typeScale.caption, },
});
