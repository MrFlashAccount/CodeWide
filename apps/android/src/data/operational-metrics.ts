export type TimingMetric =
  | "cached_thread_read_ms"
  | "image_materialize_ms"
  | "live_batch_wait_ms"
  | "live_delta_to_commit_ms"
  | "live_event_ingress_ms"
  | "live_reducer_ms"
  | "connection_to_usable_ms"
  | "history_page_rpc_ms"
  | "thread_selection_commit_ms"
  | "thread_resume_ms"
  | "timeline_first_draw_ms"
  | "thread_cached_visible_ms"
  | "thread_fresh_visible_ms"
  | "turn_items_rpc_ms"
  | "voice_drain_ms"
  | "voice_finish_ms"
  | "voice_start_ms";

export type CounterMetric =
  | "audio_overflows"
  | "image_failures"
  | "live_events"
  | "live_immediate_flushes"
  | "stream_repairs"
  | "voice_failures";

export type OperationalMetricsSnapshot = {
  timings: Partial<Record<TimingMetric, { count: number; p50Ms: number; p95Ms: number; maxMs: number }>>;
  counters: Partial<Record<CounterMetric, number>>;
};

const MAX_SAMPLES_PER_METRIC = 256;
const timingSamples = new Map<TimingMetric, number[]>();
const counters = new Map<CounterMetric, number>();
let pendingLiveCommitAt: number | null = null;

export function recordTiming(name: TimingMetric, valueMs: number): void {
  if (!Number.isFinite(valueMs) || valueMs < 0) return;
  const values = timingSamples.get(name) ?? [];
  values.push(Math.min(valueMs, 60_000));
  if (values.length > MAX_SAMPLES_PER_METRIC) values.splice(0, values.length - MAX_SAMPLES_PER_METRIC);
  timingSamples.set(name, values);
}

export function incrementMetric(name: CounterMetric, amount = 1): void {
  if (!Number.isSafeInteger(amount) || amount < 1) return;
  counters.set(name, Math.min(Number.MAX_SAFE_INTEGER, (counters.get(name) ?? 0) + amount));
}

export function markLiveBatchDelivered(): void {
  pendingLiveCommitAt ??= performance.now();
}

export function recordLiveRenderCommit(): void {
  if (pendingLiveCommitAt === null) return;
  recordTiming("live_delta_to_commit_ms", performance.now() - pendingLiveCommitAt);
  pendingLiveCommitAt = null;
}

export function operationalMetricsSnapshot(): OperationalMetricsSnapshot {
  const timings: OperationalMetricsSnapshot["timings"] = {};
  for (const [name, rawValues] of timingSamples) {
    const values = [...rawValues].sort((left, right) => left - right);
    timings[name] = {
      count: values.length,
      p50Ms: rounded(values[Math.floor(values.length * 0.5)] ?? 0),
      p95Ms: rounded(values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0),
      maxMs: rounded(values.at(-1) ?? 0),
    };
  }
  return { timings, counters: Object.fromEntries(counters) as OperationalMetricsSnapshot["counters"] };
}

export function resetOperationalMetricsForTests(): void {
  timingSamples.clear();
  counters.clear();
  pendingLiveCommitAt = null;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}
