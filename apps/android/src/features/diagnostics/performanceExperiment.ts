import {
  operationalMetricsSnapshot,
  type OperationalMetricsSnapshot,
  type TimingMetric,
} from "../../data/operational-metrics";
import {
  setPerformanceExperiment,
  type PerformanceExperimentId,
} from "../../data/performance-experiments";
import { getPerformanceMetricsSnapshot } from "../../native/performance-metrics";
import { delay } from "./performanceDelay";

const EXPERIMENT_PHASE_MS = 7000;

export const STAGE_METRICS: ReadonlyArray<{ id: TimingMetric; label: string }> = [
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
  { id: "timeline_scroll_command_ms", label: "Scroll command promise" },
  { id: "timeline_scroll_rebound_ms", label: "Scroll return after reaching end" },
];

export const EXPERIMENTS: ReadonlyArray<{
  description: string;
  id: PerformanceExperimentId;
  title: string;
}> = [
  {
    description: "Isolate the native text shader without stopping other animations.",
    id: "disableTextShimmer",
    title: "Disable text shimmer",
  },
  {
    description: "Bypass Markdown AST and rich renderers.",
    id: "plainTextMarkdown",
    title: "Plain-text Markdown",
  },
  {
    description: "Bypass the extra width-classification parse.",
    id: "skipMarkdownLayout",
    title: "Skip Markdown layout parse",
  },
  {
    description: "Replace both virtualized lists with a static placeholder.",
    id: "hideThreadLists",
    title: "Pause thread lists",
  },
  {
    description: "Stop shimmer, custom spinners and voice aura animation.",
    id: "reduceCustomMotion",
    title: "Disable custom animations",
  },
];

type ExperimentWindow = {
  cpuPercent: number;
  pssBytes: number;
  stages: Partial<Record<TimingMetric, number>>;
};

export type ExperimentResult = {
  baseline: ExperimentWindow;
  id: PerformanceExperimentId;
  variant: ExperimentWindow;
};

function measureWindow(
  startedAtMs: number,
  before: OperationalMetricsSnapshot,
  after: OperationalMetricsSnapshot,
): ExperimentWindow {
  const points = getPerformanceMetricsSnapshot().recent.filter(
    (point) => point.sampledAtMs > startedAtMs,
  );
  const stages: Partial<Record<TimingMetric, number>> = {};
  for (const { id } of STAGE_METRICS) {
    const beforeTotal = before.timings[id]?.totalMs ?? 0;
    const afterTotal = after.timings[id]?.totalMs ?? 0;
    stages[id] = Math.max(0, afterTotal - beforeTotal) / (EXPERIMENT_PHASE_MS / 1000);
  }
  return {
    cpuPercent: average(points.map((point) => point.cpuPercent)),
    pssBytes: average(points.map((point) => point.pssBytes)),
    stages,
  };
}

export async function collectExperiment(
  id: PerformanceExperimentId,
  isCurrent: () => boolean,
): Promise<ExperimentResult | null> {
  setPerformanceExperiment(id, false);
  await delay(1100);
  if (!isCurrent()) {
    return null;
  }
  const baselineStart = currentPerformanceSampleAt();
  const baselineOperational = operationalMetricsSnapshot();
  await delay(EXPERIMENT_PHASE_MS);
  if (!isCurrent()) {
    return null;
  }
  const baseline = measureWindow(baselineStart, baselineOperational, operationalMetricsSnapshot());

  setPerformanceExperiment(id, true);
  await delay(1100);
  if (!isCurrent()) {
    return null;
  }
  const variantStart = currentPerformanceSampleAt();
  const variantOperational = operationalMetricsSnapshot();
  await delay(EXPERIMENT_PHASE_MS);
  if (!isCurrent()) {
    return null;
  }
  const variant = measureWindow(variantStart, variantOperational, operationalMetricsSnapshot());
  return { baseline, id, variant };
}

function currentPerformanceSampleAt(): number {
  const current = getPerformanceMetricsSnapshot().current;
  return current === null ? 0 : current.sampledAtMs;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
