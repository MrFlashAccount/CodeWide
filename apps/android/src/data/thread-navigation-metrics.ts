import { recordDiagnosticTiming, type TimingMetric } from "./operational-metrics";
import { recordTelemetryEvent } from "./telemetry";

export type ThreadNavigationStage =
  | "selection_requested"
  | "selection_next_frame"
  | "hydration_start"
  | "hydration_result"
  | "scope_commit"
  | "timeline_model_ready"
  | "timeline_first_draw"
  | "timeline_positioned"
  | "visible_commit"
  | "next_frame"
  | "superseded";

export type ThreadNavigationFrameProfile = {
  durationMs: number;
  renderedFrames: number;
  averageFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  jankFrames: number;
  droppedFrameEstimate: number;
  hermesProfile: {
    format: "hermes-sampling-profile";
    sizeBytes: number;
    content: string | null;
    error: string | null;
  } | null;
};

export type ThreadNavigationProfile = {
  id: string;
  connectionId: string;
  threadId: string;
  trigger: string;
  status: "active" | "completed" | "superseded";
  startedAtMs: number;
  totalMs: number;
  currentStage: ThreadNavigationStage;
  bottleneckStage: ThreadNavigationStage | null;
  bottleneckMs: number;
  rowCommits: number;
  uniqueRowsCommitted: number;
  measures: readonly ThreadNavigationMeasure[];
  visualEvents: readonly ThreadNavigationVisualEvent[];
  stages: readonly {
    stage: ThreadNavigationStage;
    elapsedMs: number;
    sincePreviousMs: number;
    values: Readonly<Record<string, number>>;
    tags: Readonly<Record<string, string>>;
  }[];
  frames: ThreadNavigationFrameProfile | null;
};

export type ThreadNavigationVisualEvent = {
  name: string;
  elapsedMs: number;
  values: Readonly<Record<string, number>>;
  tags: Readonly<Record<string, string>>;
};

export type ThreadNavigationMeasure = {
  name: string;
  durationMs: number;
  elapsedMs: number;
  values: Readonly<Record<string, number>>;
  tags: Readonly<Record<string, string>>;
};

export type ThreadNavigationProfileSnapshot = {
  active: ThreadNavigationProfile | null;
  last: ThreadNavigationProfile | null;
};

type ThreadNavigation = {
  id: string;
  connectionId: string;
  threadId: string;
  trigger: string;
  startedAtMs: number;
  lastStageAtMs: number;
  stages: Set<ThreadNavigationStage>;
  stageRecords: ThreadNavigationProfile["stages"];
  rowCommits: number;
  committedRowKeys: Set<string>;
  measures: ThreadNavigationMeasure[];
  visualEvents: ThreadNavigationVisualEvent[];
};

type StageDetails = {
  values?: Record<string, number>;
  tags?: Record<string, string>;
};

const STAGE_TIMINGS: Partial<Record<ThreadNavigationStage, TimingMetric>> = {
  selection_next_frame: "thread_navigation_selection_ms",
  hydration_result: "thread_navigation_hydration_result_ms",
  scope_commit: "thread_navigation_scope_commit_ms",
  timeline_model_ready: "thread_navigation_timeline_model_ms",
  timeline_first_draw: "thread_navigation_first_draw_ms",
  timeline_positioned: "thread_navigation_positioned_ms",
  visible_commit: "thread_navigation_visible_commit_ms",
  next_frame: "thread_navigation_total_ms",
};

let activeNavigation: ThreadNavigation | null = null;
let recentNavigation: { navigation: ThreadNavigation; expiresAtMs: number } | null = null;
let profileSnapshot: ThreadNavigationProfileSnapshot = { active: null, last: null };
const profileListeners = new Set<() => void>();
const POST_NAVIGATION_OBSERVATION_MS = 5_000;
const MAX_VISUAL_EVENTS = 256;

export function beginThreadNavigation(connectionId: string, threadId: string, trigger = "thread_list"): string {
  if (activeNavigation !== null) emitStage(activeNavigation, "superseded", {}, true);
  const startedAtMs = performance.now();
  activeNavigation = {
    id: `thread-navigation-${createId()}`,
    connectionId,
    threadId,
    trigger,
    startedAtMs,
    lastStageAtMs: startedAtMs,
    stages: new Set(),
    stageRecords: [],
    rowCommits: 0,
    committedRowKeys: new Set(),
    measures: [],
    visualEvents: [],
  };
  emitStage(activeNavigation, "selection_requested");
  return activeNavigation.id;
}

export function markThreadNavigationStage(
  connectionId: string,
  threadId: string,
  stage: ThreadNavigationStage,
  details: StageDetails = {},
  expectedNavigationId?: string,
): ThreadNavigationProfile | null {
  const navigation = activeNavigation;
  if (navigation === null || navigation.connectionId !== connectionId || navigation.threadId !== threadId) return null;
  if (expectedNavigationId !== undefined && navigation.id !== expectedNavigationId) return null;
  return emitStage(navigation, stage, details, stage === "next_frame" || stage === "superseded");
}

export function recordThreadNavigationRowCommit(connectionId: string, threadId: string, rowKey: string): void {
  const navigation = activeNavigation;
  if (navigation === null || navigation.connectionId !== connectionId || navigation.threadId !== threadId) return;
  navigation.rowCommits += 1;
  navigation.committedRowKeys.add(rowKey);
}

export function isThreadNavigationActiveFor(connectionId: string, threadId: string): boolean {
  return activeNavigation?.connectionId === connectionId && activeNavigation.threadId === threadId;
}

export function activeThreadNavigationIdFor(connectionId: string, threadId: string): string | null {
  return isThreadNavigationActiveFor(connectionId, threadId) ? activeNavigation?.id ?? null : null;
}

export function hasActiveThreadNavigation(): boolean {
  return activeNavigation !== null;
}

export function recordThreadNavigationMeasure(
  connectionId: string,
  threadId: string,
  name: string,
  durationMs: number,
  details: StageDetails = {},
): void {
  const navigation = activeNavigation;
  if (navigation === null || navigation.connectionId !== connectionId || navigation.threadId !== threadId) return;
  const elapsedMs = Math.max(0, performance.now() - navigation.startedAtMs);
  const measure = {
    name,
    durationMs: Math.max(0, durationMs),
    elapsedMs,
    values: { ...details.values },
    tags: { ...details.tags },
  };
  navigation.measures.push(measure);
  recordTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_measure",
    sessionId: navigation.threadId,
    requestId: navigation.id,
    threadId: navigation.threadId,
    values: {
      durationMs: measure.durationMs,
      elapsedMs,
      ...details.values,
    },
    tags: {
      measure: name,
      trigger: navigation.trigger,
      ...details.tags,
    },
  });
}

/**
 * Records committed presentation state, including changes that happen shortly
 * after the first visible frame. Those late events are the important evidence
 * for navigation flicker: the normal latency profile has already completed by
 * then, but the user can still see a fallback, remount, or window replacement.
 */
export function recordThreadNavigationVisualEvent(
  connectionId: string,
  threadId: string,
  name: string,
  details: StageDetails = {},
  expectedNavigationId?: string,
): string | null {
  const now = performance.now();
  const navigation = activeNavigation?.connectionId === connectionId && activeNavigation.threadId === threadId
    ? activeNavigation
    : recentNavigation !== null
      && recentNavigation.expiresAtMs >= now
      && recentNavigation.navigation.connectionId === connectionId
      && recentNavigation.navigation.threadId === threadId
        ? recentNavigation.navigation
        : null;
  if (navigation === null) return null;
  if (expectedNavigationId !== undefined && navigation.id !== expectedNavigationId) return null;
  const event: ThreadNavigationVisualEvent = {
    name,
    elapsedMs: Math.max(0, now - navigation.startedAtMs),
    values: { ...details.values },
    tags: { ...details.tags },
  };
  navigation.visualEvents.push(event);
  if (navigation.visualEvents.length > MAX_VISUAL_EVENTS) navigation.visualEvents.shift();
  recordTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_visual_event",
    sessionId: navigation.threadId,
    requestId: navigation.id,
    threadId: navigation.threadId,
    values: { elapsedMs: event.elapsedMs, ...event.values },
    tags: { event: name, trigger: navigation.trigger, ...event.tags },
  });
  const status: ThreadNavigationProfile["status"] = activeNavigation?.id === navigation.id
    ? "active"
    : profileSnapshot.last?.id === navigation.id
      ? profileSnapshot.last.status
      : "completed";
  const projected = projectProfile(navigation, status);
  if (status === "active") {
    publishProfiles({ ...profileSnapshot, active: projected });
  } else if (profileSnapshot.last?.id === navigation.id) {
    publishProfiles({ ...profileSnapshot, last: { ...projected, frames: profileSnapshot.last.frames } });
  }
  return navigation.id;
}

export function recordActiveThreadNavigationMeasure(
  name: string,
  durationMs: number,
  details: StageDetails = {},
): void {
  const navigation = activeNavigation;
  if (navigation === null) return;
  recordThreadNavigationMeasure(navigation.connectionId, navigation.threadId, name, durationMs, details);
}

export function measureThreadNavigationWork<T>(
  connectionId: string,
  threadId: string | null,
  name: string,
  work: () => T,
  details: StageDetails = {},
): T {
  if (threadId === null) return work();
  const startedAtMs = performance.now();
  try {
    return work();
  } finally {
    recordThreadNavigationMeasure(connectionId, threadId, name, performance.now() - startedAtMs, details);
  }
}

export function subscribeThreadNavigationProfiles(listener: () => void): () => void {
  profileListeners.add(listener);
  return () => profileListeners.delete(listener);
}

export function getThreadNavigationProfileSnapshot(): ThreadNavigationProfileSnapshot {
  return profileSnapshot;
}

export function finalizeThreadNavigationProfile(
  profile: ThreadNavigationProfile,
  frames: ThreadNavigationFrameProfile | null,
): ThreadNavigationProfile {
  // Frame capture completes asynchronously. Preserve any visual events that
  // arrived after the navigation's first visible frame instead of replacing
  // them with the older terminal profile snapshot.
  const latest = profileSnapshot.last?.id === profile.id ? profileSnapshot.last : profile;
  const completed = { ...latest, frames };
  const slowestMeasure = completed.measures.reduce<ThreadNavigationMeasure | null>((slowest, measure) => (
    slowest === null || measure.durationMs > slowest.durationMs ? measure : slowest
  ), null);
  if (profileSnapshot.last?.id === profile.id) publishProfiles({ ...profileSnapshot, last: completed });
  recordTelemetryEvent(profile.connectionId, {
    name: "navigation.thread_profile",
    sessionId: profile.threadId,
    requestId: profile.id,
    threadId: profile.threadId,
    values: {
      totalMs: completed.totalMs,
      bottleneckMs: completed.bottleneckMs,
      rowCommits: completed.rowCommits,
      uniqueRowsCommitted: completed.uniqueRowsCommitted,
      renderedFrames: frames?.renderedFrames ?? 0,
      averageFrameMs: frames?.averageFrameMs ?? 0,
      p95FrameMs: frames?.p95FrameMs ?? 0,
      maxFrameMs: frames?.maxFrameMs ?? 0,
      jankFrames: frames?.jankFrames ?? 0,
      droppedFrameEstimate: frames?.droppedFrameEstimate ?? 0,
      measureCount: completed.measures.length,
      measureDurationSumMs: completed.measures.reduce((total, measure) => total + measure.durationMs, 0),
      visualEventCount: completed.visualEvents.length,
      maxMeasureMs: slowestMeasure?.durationMs ?? 0,
    },
    tags: {
      status: profile.status,
      bottleneckStage: profile.bottleneckStage ?? "none",
      frameTrace: frames === null ? "unavailable" : "available",
      trigger: profile.trigger,
      slowestMeasure: slowestMeasure?.name ?? "none",
      measures: "overlapping",
    },
  });
  return completed;
}

function emitStage(
  navigation: ThreadNavigation,
  stage: ThreadNavigationStage,
  details: StageDetails = {},
  terminal = false,
): ThreadNavigationProfile | null {
  if (navigation.stages.has(stage)) return null;
  const now = performance.now();
  const elapsedMs = Math.max(0, now - navigation.startedAtMs);
  const sincePreviousMs = Math.max(0, now - navigation.lastStageAtMs);
  navigation.stages.add(stage);
  navigation.lastStageAtMs = now;
  navigation.stageRecords = [...navigation.stageRecords, {
    stage,
    elapsedMs,
    sincePreviousMs,
    values: { ...details.values },
    tags: { ...details.tags },
  }];

  recordTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_stage",
    sessionId: navigation.threadId,
    requestId: navigation.id,
    threadId: navigation.threadId,
    values: {
      elapsedMs,
      sincePreviousMs,
      ...details.values,
    },
    tags: {
      stage,
      trigger: navigation.trigger,
      ...details.tags,
    },
  });

  const timing = STAGE_TIMINGS[stage];
  if (timing !== undefined) recordDiagnosticTiming(timing, elapsedMs);
  const profile = projectProfile(navigation, terminal ? stage === "superseded" ? "superseded" : "completed" : "active");
  if (terminal && activeNavigation?.id === navigation.id) {
    activeNavigation = null;
    recentNavigation = {
      navigation,
      expiresAtMs: performance.now() + POST_NAVIGATION_OBSERVATION_MS,
    };
    publishProfiles({ active: null, last: profile });
    return profile;
  }
  publishProfiles({ ...profileSnapshot, active: profile });
  return null;
}

function projectProfile(navigation: ThreadNavigation, status: ThreadNavigationProfile["status"]): ThreadNavigationProfile {
  const bottleneck = navigation.stageRecords.reduce<ThreadNavigationProfile["stages"][number] | null>((slowest, stage) => (
    stage.stage === "selection_requested" || (slowest !== null && slowest.sincePreviousMs >= stage.sincePreviousMs)
      ? slowest
      : stage
  ), null);
  const current = navigation.stageRecords.at(-1);
  return {
    id: navigation.id,
    connectionId: navigation.connectionId,
    threadId: navigation.threadId,
    trigger: navigation.trigger,
    status,
    startedAtMs: navigation.startedAtMs,
    totalMs: current?.elapsedMs ?? 0,
    currentStage: current?.stage ?? "selection_requested",
    bottleneckStage: bottleneck?.stage ?? null,
    bottleneckMs: bottleneck?.sincePreviousMs ?? 0,
    rowCommits: navigation.rowCommits,
    uniqueRowsCommitted: navigation.committedRowKeys.size,
    measures: navigation.measures,
    visualEvents: navigation.visualEvents,
    stages: navigation.stageRecords,
    frames: null,
  };
}

function publishProfiles(next: ThreadNavigationProfileSnapshot): void {
  profileSnapshot = next;
  profileListeners.forEach((listener) => listener());
}

function createId(): string {
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return runtimeCrypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function resetThreadNavigationMetricsForTests(): void {
  activeNavigation = null;
  recentNavigation = null;
  profileSnapshot = { active: null, last: null };
}
