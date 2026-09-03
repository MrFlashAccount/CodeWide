export interface PerformanceMetricPoint {
  cpuPercent: number;
  jankPercent: number;
  p95FrameMs: number;
  pssBytes: number;
  renderedFps: number;
  rxBytesPerSecond: number;
  sampledAtMs: number;
  txBytesPerSecond: number;
}

export interface CurrentPerformanceMetrics extends PerformanceMetricPoint {
  averageFrameMs: number;
  codePssBytes: number;
  droppedFrameEstimate: number;
  graphicsPssBytes: number;
  javaHeapBytes: number;
  javaHeapLimitBytes: number;
  javaHeapPssBytes: number;
  nativeHeapBytes: number;
  nativeHeapPssBytes: number;
  privateOtherPssBytes: number;
  renderedFrames: number;
  rssBytes: number;
  stackPssBytes: number;
  systemPssBytes: number;
  txSessionBytes: number;
  rxSessionBytes: number;
  uptimeMs: number;
}

export interface PerformanceMetricsSnapshot {
  available: boolean;
  current: CurrentPerformanceMetrics | null;
  enabled: boolean;
  historyCapacity: number;
  historySamples: number;
  peakCpuPercent: number;
  peakPssBytes: number;
  recent: readonly PerformanceMetricPoint[];
  sessionJankPercent: number;
  totalDroppedFrameEstimate: number;
}

export type PerformanceExperimentId =
  | "disableTextShimmer"
  | "hideThreadLists"
  | "plainTextMarkdown"
  | "reduceCustomMotion"
  | "skipMarkdownLayout";

export type PerformanceExperimentSnapshot = Readonly<Record<PerformanceExperimentId, boolean>>;

interface TimingMetricSnapshot {
  p95Ms: number;
  totalCount: number;
  totalMs: number;
}

export interface OperationalMetricsSnapshot {
  counters: Readonly<Record<string, number | undefined>>;
  gauges: Readonly<Record<string, number | undefined>>;
  timings: Readonly<Record<string, TimingMetricSnapshot | undefined>>;
}

export interface PerformanceDiagnosticsSnapshot {
  experiments: PerformanceExperimentSnapshot;
  native: PerformanceMetricsSnapshot;
  operational: OperationalMetricsSnapshot;
}

export interface DiagnosticsSource {
  copySnapshot(): Promise<void>;
  reset(): void;
  runExperiment(id: PerformanceExperimentId): Promise<void>;
  setExperiment(id: PerformanceExperimentId, enabled: boolean): void;
  setMonitoringEnabled(enabled: boolean): Promise<void>;
  snapshot(): PerformanceDiagnosticsSnapshot;
  subscribe(listener: () => void): () => void;
}

type NavigationStage =
  | "hydration_result"
  | "hydration_start"
  | "next_frame"
  | "scope_commit"
  | "selection_next_frame"
  | "selection_requested"
  | "superseded"
  | "timeline_first_draw"
  | "timeline_model_ready"
  | "timeline_positioned"
  | "visible_commit";

interface NavigationRecord {
  elapsedMs: number;
  name: string;
  tags: Readonly<Record<string, string>>;
  values: Readonly<Record<string, number>>;
}

interface NavigationMeasure extends NavigationRecord {
  durationMs: number;
}

interface NavigationStageRecord {
  elapsedMs: number;
  sincePreviousMs: number;
  stage: NavigationStage;
  tags: Readonly<Record<string, string>>;
  values: Readonly<Record<string, number>>;
}

interface HermesProfile {
  content: string | null;
  error: string | null;
  format: "hermes-sampling-profile";
  sizeBytes: number;
}

interface NavigationFrameProfile {
  droppedFrameEstimate: number;
  hermesProfile: HermesProfile | null;
  jankFrames: number;
}

export interface NavigationProfile {
  bottleneckMs: number;
  bottleneckStage: NavigationStage | null;
  currentStage: NavigationStage;
  frames: NavigationFrameProfile | null;
  id: string;
  measures: readonly NavigationMeasure[];
  rowCommits: number;
  stages: readonly NavigationStageRecord[];
  status: "active" | "completed" | "superseded";
  threadId: string;
  totalMs: number;
  uniqueRowsCommitted: number;
  visualEvents: readonly NavigationRecord[];
}

export interface NavigationProfilesSnapshot {
  active: NavigationProfile | null;
  last: NavigationProfile | null;
}

/** @testOnly Exposes the native heap artifact contract to its black-box adapter regression. */
export interface HermesHeapSnapshot {
  location: string;
  name: string;
  sizeBytes: number;
  uri: string;
}

export interface NavigationDiagnosticsSource {
  captureHeap(): Promise<HermesHeapSnapshot>;
  copyReport(profile: NavigationProfile): Promise<void>;
  snapshot(): NavigationProfilesSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface SpeedscopeProfileDocument {
  content: string;
  fileName: string;
  title: string;
}
