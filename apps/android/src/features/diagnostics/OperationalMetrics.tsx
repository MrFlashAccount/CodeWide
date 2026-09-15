import { View } from "react-native";
import { type OperationalMetricsSnapshot } from "../../data/operational-metrics";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./PerformanceDiagnostics.styles";
import { type ExperimentResult, EXPERIMENTS, STAGE_METRICS } from "./performanceExperiment";
import { bytes, decimal, integer, percent, ratio, signed } from "./performanceFormat";

export function OperationalMetrics({ metrics }: { metrics: OperationalMetricsSnapshot }) {
  const visibleStages = STAGE_METRICS.filter(({ id }) => metrics.timings[id] !== undefined);
  const jsEvents = metrics.counters.js_sync_events ?? 0;
  const jsBatches = metrics.counters.js_sync_event_batches ?? 0;
  const renderCommits = metrics.counters.live_render_commits ?? 0;
  const renderedProjectionBatches = metrics.counters.live_render_projection_batches ?? 0;
  return (
    <View style={styles.experimentCard}>
      <Text style={styles.chartTitle}>JS hot paths</Text>
      <Text style={styles.chartSubtitle}>
        Aggregate wall time since reset. Samples retain the latest 256 values; totals never roll
        over.
      </Text>
      {visibleStages.length === 0 ? (
        <Text style={styles.notice}>Waiting for instrumented work…</Text>
      ) : (
        visibleStages.map(({ id, label }) => {
          const timing = metrics.timings[id];
          if (timing === undefined) return null;
          return (
            <View key={id} style={styles.stageRow}>
              <Text style={styles.stageLabel}>{label}</Text>
              <Text style={styles.stageValue}>
                {decimal(timing.totalMs)} ms · {integer(timing.totalCount)} calls · p95{" "}
                {decimal(timing.p95Ms)} ms
              </Text>
            </View>
          );
        })
      )}
      <View style={styles.counterWrap}>
        <Text style={styles.counterText}>
          socket deltas {integer(metrics.counters.live_ingress_events ?? 0)} /{" "}
          {integer(metrics.counters.live_ingress_chars ?? 0)} chars
        </Text>
        <Text style={styles.counterText}>
          projected deltas {integer(metrics.counters.live_events ?? 0)} /{" "}
          {integer(metrics.counters.live_projected_chars ?? 0)} chars
        </Text>
        <Text style={styles.counterText}>
          React commits {integer(renderCommits)} /{" "}
          {integer(metrics.counters.live_render_chars ?? 0)} chars
        </Text>
        <Text style={styles.counterText}>
          projection batches/commit {ratio(renderedProjectionBatches, renderCommits)}
        </Text>
        <Text style={styles.counterText}>
          JS events {integer(jsEvents)} / {integer(jsBatches)} batches ({ratio(jsEvents, jsBatches)}{" "}
          avg)
        </Text>
        <Text style={styles.counterText}>
          JS ingress events {integer(metrics.counters.js_sync_ingress_events ?? 0)}
        </Text>
        <Text style={styles.counterText}>
          pending render {integer(metrics.gauges.livePendingStreams)} streams /{" "}
          {integer(metrics.gauges.livePendingChars)} chars /{" "}
          {decimal(metrics.gauges.liveOldestPendingMs)} ms oldest
        </Text>
        <Text style={styles.counterText}>
          lifecycle flushes {integer(metrics.counters.live_immediate_flushes ?? 0)}
        </Text>
        <Text style={styles.counterText}>
          native fallback events {integer(metrics.counters.native_events ?? 0)} /{" "}
          {integer(metrics.counters.native_event_batches ?? 0)} batches
        </Text>
        <Text style={styles.counterText}>
          event bytes {bytes(metrics.counters.native_event_bytes ?? 0)}
        </Text>
        <Text style={styles.counterText}>
          MD chars {integer(metrics.counters.markdown_parse_chars ?? 0)}
        </Text>
        <Text style={styles.counterText}>
          row commits {integer(metrics.counters.thread_row_commits ?? 0)}
        </Text>
        <Text style={styles.counterText}>
          SQLite subset rows {integer(metrics.gauges.sqliteSubsetLastRows)} last /{" "}
          {integer(metrics.gauges.sqliteSubsetMaxRows)} max /{" "}
          {integer(metrics.counters.sqlite_subset_rows_loaded ?? 0)} total
        </Text>
        <Text style={styles.counterText}>
          thread detail resident rows {integer(metrics.gauges.threadDetailResidentRows)}
        </Text>
      </View>
    </View>
  );
}

export function ExperimentResultCard({ result }: { result: ExperimentResult }) {
  const experiment = EXPERIMENTS.find(({ id }) => id === result.id);
  return (
    <View style={styles.resultCard}>
      <Text style={styles.chartTitle}>{experiment?.title ?? result.id} result</Text>
      <Text style={styles.resultHeadline}>
        CPU {percent(result.baseline.cpuPercent)} → {percent(result.variant.cpuPercent)} (
        {signed(result.variant.cpuPercent - result.baseline.cpuPercent)} pp)
      </Text>
      <Text style={styles.experimentDescription}>
        PSS {bytes(result.baseline.pssBytes)} → {bytes(result.variant.pssBytes)}
      </Text>
      {STAGE_METRICS.map(({ id, label }) => {
        const baseline = result.baseline.stages[id] ?? 0;
        const variant = result.variant.stages[id] ?? 0;
        if (baseline === 0 && variant === 0) return null;
        return (
          <Text key={id} style={styles.experimentDescription}>
            {label}: {decimal(baseline)} → {decimal(variant)} ms/s
          </Text>
        );
      })}
      <Text style={styles.chartSubtitle}>
        Treat this as a lead, not proof: both 7-second windows need comparable incoming work.
      </Text>
    </View>
  );
}
