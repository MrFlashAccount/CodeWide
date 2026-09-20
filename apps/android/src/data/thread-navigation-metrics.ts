import { recordDiagnosticTiming, type TimingMetric } from "./operational-metrics";
import { recordOperationalTelemetryEvent, recordTelemetryEvent } from "./telemetry";
import { recordFrameContext } from "./ui-frame-telemetry";

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
  averageFrameMs: number;
  droppedFrameEstimate: number;
  durationMs: number;
  hermesProfile: {
    content: string | null;
    error: string | null;
    format: "hermes-sampling-profile";
    sizeBytes: number;
  } | null;
  jankFrames: number;
  maxFrameMs: number;
  p95FrameMs: number;
  renderedFrames: number;
};

export type ThreadNavigationProfile = {
  bottleneckMs: number;
  bottleneckStage: ThreadNavigationStage | null;
  connectionId: string;
  currentStage: ThreadNavigationStage;
  frames: ThreadNavigationFrameProfile | null;
  id: string;
  measures: readonly ThreadNavigationMeasure[];
  rowCommits: number;
  stages: readonly {
    elapsedMs: number;
    sincePreviousMs: number;
    stage: ThreadNavigationStage;
    tags: Readonly<Record<string, string>>;
    values: Readonly<Record<string, number>>;
  }[];
  startedAtMs: number;
  status: "active" | "completed" | "superseded";
  threadId: string;
  totalMs: number;
  trigger: string;
  uniqueRowsCommitted: number;
  visualEvents: readonly ThreadNavigationVisualEvent[];
};

type ThreadNavigationVisualEvent = {
  elapsedMs: number;
  name: string;
  tags: Readonly<Record<string, string>>;
  values: Readonly<Record<string, number>>;
};

type ThreadNavigationMeasure = {
  durationMs: number;
  elapsedMs: number;
  name: string;
  tags: Readonly<Record<string, string>>;
  values: Readonly<Record<string, number>>;
};

export type ThreadNavigationProfileSnapshot = {
  active: ThreadNavigationProfile | null;
  last: ThreadNavigationProfile | null;
};

type ThreadNavigation = {
  committedRowKeys: Set<string>;
  connectionId: string;
  id: string;
  lastStageAtMs: number;
  measures: ThreadNavigationMeasure[];
  rowCommits: number;
  stageRecords: ThreadNavigationProfile["stages"];
  stages: Set<ThreadNavigationStage>;
  startedAtMs: number;
  threadId: string;
  trigger: string;
  visualEvents: ThreadNavigationVisualEvent[];
};

type StageDetails = {
  tags?: Record<string, string>;
  values?: Record<string, number>;
};

const STAGE_TIMINGS: Partial<Record<ThreadNavigationStage, TimingMetric>> = {
  hydration_result: "thread_navigation_hydration_result_ms",
  next_frame: "thread_navigation_total_ms",
  scope_commit: "thread_navigation_scope_commit_ms",
  selection_next_frame: "thread_navigation_selection_ms",
  timeline_first_draw: "thread_navigation_first_draw_ms",
  timeline_model_ready: "thread_navigation_timeline_model_ms",
  timeline_positioned: "thread_navigation_positioned_ms",
  visible_commit: "thread_navigation_visible_commit_ms",
};

let activeNavigation: ThreadNavigation | null = null;
let recentNavigation: { expiresAtMs: number; navigation: ThreadNavigation } | null = null;
let profileSnapshot: ThreadNavigationProfileSnapshot = { active: null, last: null };
let nextNavigationProfileArmed = false;
const profileListeners = new Set<() => void>();
const POST_NAVIGATION_OBSERVATION_MS = 5000;
const MAX_VISUAL_EVENTS = 256;

export function beginThreadNavigation(
  connectionId: string,
  threadId: string,
  trigger = "thread_list",
): string | null {
  if (activeNavigation !== null) {
    emitStage(activeNavigation, "superseded", {}, true);
  }
  if (!nextNavigationProfileArmed) {
    return null;
  }
  nextNavigationProfileArmed = false;
  const startedAtMs = performance.now();
  activeNavigation = {
    committedRowKeys: new Set(),
    connectionId,
    id: `thread-navigation-${createId()}`,
    lastStageAtMs: startedAtMs,
    measures: [],
    rowCommits: 0,
    stageRecords: [],
    stages: new Set(),
    startedAtMs,
    threadId,
    trigger,
    visualEvents: [],
  };
  recordFrameContext(connectionId, threadId, activeNavigation.id);
  emitStage(activeNavigation, "selection_requested");
  return activeNavigation.id;
}

/** Arms detailed JS navigation instrumentation for exactly one subsequent chat selection. */
export function armNextThreadNavigationProfile(): void {
  nextNavigationProfileArmed = true;
}

export function markThreadNavigationStage(
  connectionId: string,
  threadId: string,
  stage: ThreadNavigationStage,
  details: StageDetails = {},
  expectedNavigationId?: string,
): ThreadNavigationProfile | null {
  const navigation = activeNavigation;
  if (
    navigation === null ||
    navigation.connectionId !== connectionId ||
    navigation.threadId !== threadId
  ) {
    return null;
  }
  if (expectedNavigationId !== undefined && navigation.id !== expectedNavigationId) {
    return null;
  }
  return emitStage(navigation, stage, details, stage === "next_frame" || stage === "superseded");
}

export function recordThreadNavigationRowCommit(
  connectionId: string,
  threadId: string,
  rowKey: string,
): void {
  const navigation = activeNavigation;
  if (
    navigation === null ||
    navigation.connectionId !== connectionId ||
    navigation.threadId !== threadId
  ) {
    return;
  }
  navigation.rowCommits += 1;
  navigation.committedRowKeys.add(rowKey);
}

export function isThreadNavigationActiveFor(connectionId: string, threadId: string): boolean {
  return activeNavigation?.connectionId === connectionId && activeNavigation.threadId === threadId;
}

export function activeThreadNavigationIdFor(connectionId: string, threadId: string): string | null {
  return isThreadNavigationActiveFor(connectionId, threadId)
    ? (activeNavigation?.id ?? null)
    : null;
}

export function recordThreadNavigationMeasure(
  connectionId: string,
  threadId: string,
  name: string,
  durationMs: number,
  details: StageDetails = {},
): void {
  const navigation = activeNavigation;
  if (
    navigation === null ||
    navigation.connectionId !== connectionId ||
    navigation.threadId !== threadId
  ) {
    return;
  }
  const elapsedMs = Math.max(0, performance.now() - navigation.startedAtMs);
  const measure = {
    durationMs: Math.max(0, durationMs),
    elapsedMs,
    name,
    tags: { ...details.tags },
    values: { ...details.values },
  };
  navigation.measures.push(measure);
  recordTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_measure",
    requestId: navigation.id,
    sessionId: navigation.threadId,
    tags: {
      measure: name,
      trigger: navigation.trigger,
      ...details.tags,
    },
    threadId: navigation.threadId,
    values: {
      durationMs: measure.durationMs,
      elapsedMs,
      ...details.values,
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
  const navigation =
    activeNavigation?.connectionId === connectionId && activeNavigation.threadId === threadId
      ? activeNavigation
      : recentNavigation !== null &&
          recentNavigation.expiresAtMs >= now &&
          recentNavigation.navigation.connectionId === connectionId &&
          recentNavigation.navigation.threadId === threadId
        ? recentNavigation.navigation
        : null;
  if (navigation === null) {
    return null;
  }
  if (expectedNavigationId !== undefined && navigation.id !== expectedNavigationId) {
    return null;
  }
  const event: ThreadNavigationVisualEvent = {
    elapsedMs: Math.max(0, now - navigation.startedAtMs),
    name,
    tags: { ...details.tags },
    values: { ...details.values },
  };
  navigation.visualEvents.push(event);
  if (navigation.visualEvents.length > MAX_VISUAL_EVENTS) {
    navigation.visualEvents.shift();
  }
  recordTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_visual_event",
    requestId: navigation.id,
    sessionId: navigation.threadId,
    tags: { event: name, trigger: navigation.trigger, ...event.tags },
    threadId: navigation.threadId,
    values: { elapsedMs: event.elapsedMs, ...event.values },
  });
  const status: ThreadNavigationProfile["status"] =
    activeNavigation?.id === navigation.id
      ? "active"
      : profileSnapshot.last?.id === navigation.id
        ? profileSnapshot.last.status
        : "completed";
  const projected = projectProfile(navigation, status);
  if (status === "active") {
    publishProfiles({ ...profileSnapshot, active: projected });
  } else if (profileSnapshot.last?.id === navigation.id) {
    publishProfiles({
      ...profileSnapshot,
      last: { ...projected, frames: profileSnapshot.last.frames },
    });
  }
  return navigation.id;
}

export function recordActiveThreadNavigationMeasure(
  name: string,
  durationMs: number,
  details: StageDetails = {},
): void {
  const navigation = activeNavigation;
  if (navigation === null) {
    return;
  }
  recordThreadNavigationMeasure(
    navigation.connectionId,
    navigation.threadId,
    name,
    durationMs,
    details,
  );
}

export function measureThreadNavigationWork<T>(
  connectionId: string,
  threadId: string | null,
  name: string,
  work: () => T,
  details: StageDetails = {},
): T {
  if (threadId === null || !isThreadNavigationActiveFor(connectionId, threadId)) {
    return work();
  }
  const startedAtMs = performance.now();
  try {
    return work();
  } finally {
    recordThreadNavigationMeasure(
      connectionId,
      threadId,
      name,
      performance.now() - startedAtMs,
      details,
    );
  }
}

export function subscribeThreadNavigationProfiles(listener: () => void): () => void {
  profileListeners.add(listener);
  return () => {
    profileListeners.delete(listener);
  };
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
  const slowestMeasure = completed.measures.reduce<ThreadNavigationMeasure | null>(
    (slowest, measure) =>
      slowest === null || measure.durationMs > slowest.durationMs ? measure : slowest,
    null,
  );
  if (profileSnapshot.last?.id === profile.id) {
    publishProfiles({ ...profileSnapshot, last: completed });
  }
  recordTelemetryEvent(profile.connectionId, {
    name: "navigation.thread_profile",
    requestId: profile.id,
    sessionId: profile.threadId,
    tags: {
      bottleneckStage: profile.bottleneckStage ?? "none",
      frameTrace: frames === null ? "unavailable" : "available",
      measures: "overlapping",
      slowestMeasure: slowestMeasure?.name ?? "none",
      status: profile.status,
      trigger: profile.trigger,
    },
    threadId: profile.threadId,
    values: {
      averageFrameMs: frames?.averageFrameMs ?? 0,
      bottleneckMs: completed.bottleneckMs,
      droppedFrameEstimate: frames?.droppedFrameEstimate ?? 0,
      jankFrames: frames?.jankFrames ?? 0,
      maxFrameMs: frames?.maxFrameMs ?? 0,
      maxMeasureMs: slowestMeasure?.durationMs ?? 0,
      measureCount: completed.measures.length,
      measureDurationSumMs: completed.measures.reduce(
        (total, measure) => total + measure.durationMs,
        0,
      ),
      p95FrameMs: frames?.p95FrameMs ?? 0,
      renderedFrames: frames?.renderedFrames ?? 0,
      rowCommits: completed.rowCommits,
      totalMs: completed.totalMs,
      uniqueRowsCommitted: completed.uniqueRowsCommitted,
      visualEventCount: completed.visualEvents.length,
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
  if (navigation.stages.has(stage)) {
    return null;
  }
  const now = performance.now();
  const elapsedMs = Math.max(0, now - navigation.startedAtMs);
  const sincePreviousMs = Math.max(0, now - navigation.lastStageAtMs);
  navigation.stages.add(stage);
  navigation.lastStageAtMs = now;
  navigation.stageRecords = [
    ...navigation.stageRecords,
    {
      elapsedMs,
      sincePreviousMs,
      stage,
      tags: { ...details.tags },
      values: { ...details.values },
    },
  ];

  recordOperationalTelemetryEvent(navigation.connectionId, {
    name: "navigation.thread_stage",
    requestId: navigation.id,
    sessionId: navigation.threadId,
    tags: {
      stage,
      trigger: navigation.trigger,
      ...details.tags,
    },
    threadId: navigation.threadId,
    values: {
      elapsedMs,
      sincePreviousMs,
      ...details.values,
    },
  });

  const timing = STAGE_TIMINGS[stage];
  if (timing !== undefined) {
    recordDiagnosticTiming(timing, elapsedMs);
  }
  const profile = projectProfile(
    navigation,
    terminal ? (stage === "superseded" ? "superseded" : "completed") : "active",
  );
  if (terminal && activeNavigation?.id === navigation.id) {
    activeNavigation = null;
    recentNavigation = {
      expiresAtMs: performance.now() + POST_NAVIGATION_OBSERVATION_MS,
      navigation,
    };
    publishProfiles({ active: null, last: profile });
    return profile;
  }
  publishProfiles({ ...profileSnapshot, active: profile });
  return null;
}

function projectProfile(
  navigation: ThreadNavigation,
  status: ThreadNavigationProfile["status"],
): ThreadNavigationProfile {
  const bottleneck = navigation.stageRecords.reduce<
    ThreadNavigationProfile["stages"][number] | null
  >(
    (slowest, stage) =>
      stage.stage === "selection_requested" ||
      (slowest !== null && slowest.sincePreviousMs >= stage.sincePreviousMs)
        ? slowest
        : stage,
    null,
  );
  const current = navigation.stageRecords.at(-1);
  return {
    bottleneckMs: bottleneck?.sincePreviousMs ?? 0,
    bottleneckStage: bottleneck?.stage ?? null,
    connectionId: navigation.connectionId,
    currentStage: current?.stage ?? "selection_requested",
    frames: null,
    id: navigation.id,
    measures: navigation.measures,
    rowCommits: navigation.rowCommits,
    stages: navigation.stageRecords,
    startedAtMs: navigation.startedAtMs,
    status,
    threadId: navigation.threadId,
    totalMs: current?.elapsedMs ?? 0,
    trigger: navigation.trigger,
    uniqueRowsCommitted: navigation.committedRowKeys.size,
    visualEvents: navigation.visualEvents,
  };
}

function publishProfiles(next: ThreadNavigationProfileSnapshot): void {
  profileSnapshot = next;
  profileListeners.forEach((listener) => {
    listener();
  });
}

function createId(): string {
  // WHY: older Hermes runtimes may omit randomUUID even though the shared TypeScript DOM library
  // declares it; navigation diagnostics retain the existing local fallback before polyfill startup.
  const runtimeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return (
    runtimeCrypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

export function resetThreadNavigationMetricsForTests(): void {
  activeNavigation = null;
  nextNavigationProfileArmed = false;
  recentNavigation = null;
  profileSnapshot = { active: null, last: null };
}
