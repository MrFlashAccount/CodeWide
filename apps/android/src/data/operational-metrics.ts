import { recordTelemetryEvent } from "./telemetry";

export type TimingMetric =
  | "cached_thread_read_ms"
  | "image_materialize_ms"
  | "live_batch_wait_ms"
  | "live_delta_to_commit_ms"
  | "live_event_ingress_ms"
  | "live_ingress_gap_ms"
  | "live_reducer_ms"
  | "markdown_parse_ms"
  | "native_json_decode_ms"
  | "native_journal_commit_ms"
  | "projection_apply_ms"
  | "sqlite_checkpoint_ms"
  | "sqlite_subset_load_ms"
  | "connection_to_usable_ms"
  | "history_page_rpc_ms"
  | "thread_selection_next_frame_ms"
  | "thread_navigation_selection_ms"
  | "thread_navigation_hydration_result_ms"
  | "thread_navigation_scope_commit_ms"
  | "thread_navigation_timeline_model_ms"
  | "thread_navigation_first_draw_ms"
  | "thread_navigation_positioned_ms"
  | "thread_navigation_visible_commit_ms"
  | "thread_navigation_total_ms"
  | "thread_resume_ms"
  | "timeline_first_draw_ms"
  | "thread_cached_visible_ms"
  | "thread_fresh_visible_ms"
  | "thread_detail_projection_ms"
  | "thread_summary_projection_ms"
  | "turn_items_rpc_ms"
  | "voice_drain_ms"
  | "voice_finish_ms"
  | "voice_start_ms";

export type CounterMetric =
  | "audio_overflows"
  | "image_failures"
  | "js_sync_event_batches"
  | "js_sync_events"
  | "js_sync_ingress_events"
  | "live_events"
  | "live_ingress_chars"
  | "live_ingress_events"
  | "live_immediate_flushes"
  | "live_projected_batches"
  | "live_projected_chars"
  | "live_render_chars"
  | "live_render_commits"
  | "live_render_projection_batches"
  | "markdown_parse_chars"
  | "markdown_parse_requests"
  | "native_event_batches"
  | "native_event_bytes"
  | "native_events"
  | "native_journal_commits"
  | "native_journal_committed_events"
  | "sqlite_checkpoints"
  | "sqlite_subset_loads"
  | "sqlite_subset_rows_loaded"
  | "sqlite_transactions_coalesced"
  | "stream_repair_mismatches"
  | "stream_repairs"
  | "thread_row_commits"
  | "voice_failures";

export type OperationalMetricsSnapshot = {
  timings: Partial<Record<TimingMetric, {
    count: number;
    totalCount: number;
    totalMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  }>>;
  counters: Partial<Record<CounterMetric, number>>;
  gauges: {
    livePendingStreams: number;
    livePendingChars: number;
    liveOldestPendingMs: number;
    sqliteSubsetLastRows: number;
    sqliteSubsetMaxRows: number;
    threadDetailResidentRows: number;
  };
};

const MAX_SAMPLES_PER_METRIC = 256;
const timingSamples = new Map<TimingMetric, number[]>();
const timingTotals = new Map<TimingMetric, { count: number; totalMs: number }>();
const counters = new Map<CounterMetric, number>();
const MAX_PENDING_LIVE_STREAMS = 256;
const pendingLiveCommits = new Map<string, { firstAtMs: number; chars: number; projectionBatches: number }>();
let diagnosticsEnabled = false;
let sqliteSubsetLastRows = 0;
let sqliteSubsetMaxRows = 0;
let threadDetailResidentRows = 0;

export function recordTiming(name: TimingMetric, valueMs: number): void {
  if (!Number.isFinite(valueMs) || valueMs < 0) return;
  const values = timingSamples.get(name) ?? [];
  values.push(Math.min(valueMs, 60_000));
  if (values.length > MAX_SAMPLES_PER_METRIC) values.splice(0, values.length - MAX_SAMPLES_PER_METRIC);
  timingSamples.set(name, values);
  const total = timingTotals.get(name) ?? { count: 0, totalMs: 0 };
  total.count = Math.min(Number.MAX_SAFE_INTEGER, total.count + 1);
  total.totalMs = Math.min(Number.MAX_SAFE_INTEGER, total.totalMs + Math.min(valueMs, 60_000));
  timingTotals.set(name, total);
}

export function incrementMetric(name: CounterMetric, amount = 1): void {
  if (!Number.isSafeInteger(amount) || amount < 1) return;
  counters.set(name, Math.min(Number.MAX_SAFE_INTEGER, (counters.get(name) ?? 0) + amount));
}

export function recordSqliteSubsetLoad(rowCount: number, durationMs: number): void {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) return;
  recordTiming("sqlite_subset_load_ms", durationMs);
  incrementMetric("sqlite_subset_loads");
  if (rowCount > 0) incrementMetric("sqlite_subset_rows_loaded", rowCount);
  sqliteSubsetLastRows = rowCount;
  sqliteSubsetMaxRows = Math.max(sqliteSubsetMaxRows, rowCount);
}

export function setThreadDetailResidentRows(rowCount: number): void {
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) return;
  threadDetailResidentRows = rowCount;
}

/** Hot-path diagnostics are inert unless Data for geeks is explicitly enabled. */
export function recordDiagnosticTiming(name: TimingMetric, valueMs: number): void {
  if (diagnosticsEnabled) recordTiming(name, valueMs);
}

/** Hot-path diagnostics are inert unless Data for geeks is explicitly enabled. */
export function incrementDiagnosticMetric(name: CounterMetric, amount = 1): void {
  if (diagnosticsEnabled) incrementMetric(name, amount);
}

export function setOperationalDiagnosticsEnabled(enabled: boolean): void {
  diagnosticsEnabled = enabled;
}

export function operationalDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

export function liveStreamMetricKey(connectionId: unknown, threadId: unknown, turnId: unknown, itemId: unknown): string | null {
  if (![connectionId, threadId, turnId, itemId].every((value) => typeof value === "string" && value !== "")) return null;
  return `${connectionId as string}\u0000${threadId as string}\u0000${turnId as string}\u0000${itemId as string}`;
}

export function markLiveBatchDelivered(streamKey: string, deltaChars: number, values: Record<string, number> = {}): void {
  if (!Number.isSafeInteger(deltaChars) || deltaChars < 1) return;
  const previous = pendingLiveCommits.get(streamKey);
  if (previous === undefined) {
    if (pendingLiveCommits.size >= MAX_PENDING_LIVE_STREAMS) pendingLiveCommits.delete(pendingLiveCommits.keys().next().value as string);
    pendingLiveCommits.set(streamKey, { firstAtMs: performance.now(), chars: deltaChars, projectionBatches: 1 });
  } else {
    previous.chars = Math.min(Number.MAX_SAFE_INTEGER, previous.chars + deltaChars);
    previous.projectionBatches = Math.min(Number.MAX_SAFE_INTEGER, previous.projectionBatches + 1);
  }
  if (diagnosticsEnabled) {
    incrementMetric("live_projected_batches");
    incrementMetric("live_projected_chars", deltaChars);
  }
  const dimensions = liveStreamDimensions(streamKey);
  if (dimensions !== null) {
    recordTelemetryEvent(dimensions.connectionId, {
      name: "stream.projection_batch",
      sessionId: dimensions.threadId,
      ...dimensions,
      values: { deltaChars, projectionBatches: 1, ...values },
    });
  }
}

export function recordLiveRenderCommit(streamKey: string): void {
  const pending = pendingLiveCommits.get(streamKey);
  if (pending === undefined) return;
  pendingLiveCommits.delete(streamKey);
  const latencyMs = performance.now() - pending.firstAtMs;
  if (diagnosticsEnabled) {
    recordTiming("live_delta_to_commit_ms", latencyMs);
    incrementMetric("live_render_commits");
    incrementMetric("live_render_chars", pending.chars);
    incrementMetric("live_render_projection_batches", pending.projectionBatches);
  }
  const dimensions = liveStreamDimensions(streamKey);
  if (dimensions !== null) {
    recordTelemetryEvent(dimensions.connectionId, {
      name: "stream.react_commit",
      sessionId: dimensions.threadId,
      ...dimensions,
      values: {
        latencyMs,
        chars: pending.chars,
        projectionBatches: pending.projectionBatches,
      },
      tags: { renderer: "react-native" },
    });
  }
}

export function operationalMetricsSnapshot(): OperationalMetricsSnapshot {
  const timings: OperationalMetricsSnapshot["timings"] = {};
  for (const [name, rawValues] of timingSamples) {
    const values = [...rawValues].sort((left, right) => left - right);
    const total = timingTotals.get(name) ?? { count: values.length, totalMs: values.reduce((sum, value) => sum + value, 0) };
    timings[name] = {
      count: values.length,
      totalCount: total.count,
      totalMs: rounded(total.totalMs),
      p50Ms: rounded(values[Math.floor(values.length * 0.5)] ?? 0),
      p95Ms: rounded(values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0),
      maxMs: rounded(values.at(-1) ?? 0),
    };
  }
  const now = performance.now();
  let livePendingChars = 0;
  let liveOldestPendingMs = 0;
  for (const pending of pendingLiveCommits.values()) {
    livePendingChars += pending.chars;
    liveOldestPendingMs = Math.max(liveOldestPendingMs, now - pending.firstAtMs);
  }
  return {
    timings,
    counters: Object.fromEntries(counters) as OperationalMetricsSnapshot["counters"],
    gauges: {
      livePendingStreams: pendingLiveCommits.size,
      livePendingChars,
      liveOldestPendingMs: rounded(liveOldestPendingMs),
      sqliteSubsetLastRows,
      sqliteSubsetMaxRows,
      threadDetailResidentRows,
    },
  };
}

export function resetOperationalMetrics(): void {
  timingSamples.clear();
  timingTotals.clear();
  counters.clear();
  pendingLiveCommits.clear();
  sqliteSubsetLastRows = 0;
  sqliteSubsetMaxRows = 0;
  threadDetailResidentRows = 0;
}

export function resetOperationalMetricsForTests(): void {
  resetOperationalMetrics();
  diagnosticsEnabled = false;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function liveStreamDimensions(streamKey: string): { connectionId: string; threadId: string; turnId: string; itemId: string } | null {
  const [connectionId, threadId, turnId, itemId, extra] = streamKey.split("\u0000");
  if (extra !== undefined || connectionId === undefined || threadId === undefined || turnId === undefined || itemId === undefined) return null;
  return { connectionId, threadId, turnId, itemId };
}
