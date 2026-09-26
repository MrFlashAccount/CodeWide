import { incrementMetric, recordTiming } from "./operational-metrics";
import type {
  TimelineListGeometry,
  TimelineScrollGesture,
  TimelineScrollObservation,
  TimelineScrollPolicy,
  TimelineScrollSource,
  TimelineScrollTarget,
} from "./timelineScrollDiagnosticContract";
import { type TimelineScrollJournal, timelineScrollJournal } from "./timelineScrollJournal";

const SAMPLE_INTERVAL_MS = 250;
const REBOUND_WINDOW_MS = 1500;
const END_EPSILON_PX = 2;
const GESTURE_TRAVEL_THRESHOLD_PX = 32;
const REBOUND_MIN_DISTANCE_PX = 64;
const REBOUND_VIEWPORT_RATIO = 0.5;
const POLICY_KEYS = [
  "anchorIndex",
  "anchorReason",
  "anchorTurnId",
  "awayFromLatest",
  "containsBeginning",
  "containsLatest",
  "fullscreenCovered",
  "initialScrollAtEnd",
  "jumpRequestId",
  "rowCount",
  "scrollEnabled",
  "searchActive",
  "timelinePositioned",
] as const satisfies readonly (keyof TimelineScrollPolicy)[];
let nextSessionId = 0;

type ScrollCommand = {
  readonly id: number;
  readonly source: TimelineScrollSource;
  readonly startedAt: number;
  readonly target: TimelineScrollTarget;
};

type PhysicalScroll = {
  readonly contentHeightPx: number;
  readonly offsetY: number;
  readonly viewportHeightPx: number;
};

type TailArrival = PhysicalScroll & { readonly at: number; readonly commandId: number };

/** Observes one mounted list; never mutates its position or retains message/render data. */
export class TimelineScrollDiagnostics {
  readonly #sessionId = ++nextSessionId;
  readonly #connectionId: string | null;
  readonly #threadId: string | null;
  readonly #journal: TimelineScrollJournal;
  #commandId = 0;
  #lastCommand: ScrollCommand | null = null;
  #endCommand: ScrollCommand | null = null;
  #tailArrival: TailArrival | null = null;
  #lastSampleAt = Number.NEGATIVE_INFINITY;
  #dragStartOffset: number | null = null;
  #gestureTravelPx = 0;
  #gestureActive = false;
  #gestureReturnRecorded = false;
  #policy: TimelineScrollPolicy | null = null;
  #anchorApplications = 0;

  constructor(
    connectionId: string | null,
    threadId: string | null,
    journal = timelineScrollJournal,
  ) {
    this.#connectionId = connectionId;
    this.#threadId = threadId;
    this.#journal = journal;
  }

  /** Records every app-issued position command before invoking the list. */
  beginCommand(
    source: TimelineScrollSource,
    target: TimelineScrollTarget,
    geometry: TimelineListGeometry | null,
  ): ScrollCommand {
    const command = { id: ++this.#commandId, source, startedAt: performance.now(), target };
    this.#lastCommand = command;
    if (target.kind === "end") {
      this.#endCommand = command;
    }
    incrementMetric("timeline_scroll_commands");
    this.#recordCommand(command, "issued", geometry);
    return command;
  }

  /** Promise completion is recorded separately from evidence that the physical target was reached. */
  finishCommand(
    command: ScrollCommand,
    phase: "resolved" | "rejected",
    geometry: TimelineListGeometry | null,
  ): void {
    const durationMs = performance.now() - command.startedAt;
    recordTiming("timeline_scroll_command_ms", durationMs);
    if (phase === "rejected") {
      incrementMetric("timeline_scroll_command_failures");
    }
    this.#recordCommand(command, phase, geometry);
  }

  /** Keeps at most four regular physical samples per second; rebound detection sees every existing JS event. */
  scroll(offsetY: number, contentHeightPx: number, viewportHeightPx: number): boolean {
    const now = performance.now();
    const current = { contentHeightPx, offsetY, viewportHeightPx };
    const rebound = this.#detectRebound(current, now);
    if (this.#dragStartOffset !== null) {
      this.#gestureTravelPx = Math.max(
        this.#gestureTravelPx,
        Math.abs(offsetY - this.#dragStartOffset),
      );
    }
    if (now - this.#lastSampleAt < SAMPLE_INTERVAL_MS && !rebound) {
      return false;
    }
    this.#lastSampleAt = now;
    this.#emit(
      "sample",
      {
        tags: {},
        values: { ...current, distanceFromEndPx: distanceFromEnd(current) },
      },
      false,
    );
    return true;
  }

  /** Pairs native gesture boundaries with actual travel, without assuming a tap is a stuck scroll. */
  gesture(phase: TimelineScrollGesture, current: PhysicalScroll): void {
    this.#gestureActive = phase === "drag-start" || phase === "momentum-start";
    if (phase === "drag-start") {
      this.#dragStartOffset = current.offsetY;
      this.#gestureTravelPx = 0;
      this.#gestureReturnRecorded = false;
      this.#tailArrival = null;
      this.#endCommand = null;
    }
    const netTravelPx =
      this.#dragStartOffset === null ? 0 : Math.abs(current.offsetY - this.#dragStartOffset);
    const returnedToStart = isGestureReturn(
      this.#gestureActive,
      this.#gestureTravelPx,
      netTravelPx,
    );
    if (returnedToStart && !this.#gestureReturnRecorded) {
      this.#gestureReturnRecorded = true;
      incrementMetric("timeline_scroll_gesture_returns");
    }
    this.#emit(
      "gesture",
      {
        tags: { phase },
        values: {
          ...current,
          netTravelPx,
          returnedToStart: Number(returnedToStart),
          travelPx: this.#gestureTravelPx,
        },
      },
      true,
    );
    if (phase === "momentum-end") {
      this.#dragStartOffset = null;
    }
  }

  /** Records only the closed, content-free observation contract. */
  record(event: TimelineScrollObservation): void {
    switch (event.kind) {
      case "policy":
        this.#recordPolicy(event.policy);
        break;
      case "anchor-ready":
        if (event.accepted) {
          this.#anchorApplications += 1;
          if (this.#anchorApplications > 1) {
            incrementMetric("timeline_scroll_anchor_reapplications");
          }
        }
        this.#emit(
          event.kind,
          {
            tags: {},
            values: {
              accepted: Number(event.accepted),
              anchorIndex: event.anchorIndex ?? -1,
              applications: this.#anchorApplications,
              keyMatches: Number(event.keyMatches),
              sizePx: event.sizePx,
            },
          },
          true,
        );
        break;
      case "jump":
        this.#emit(
          event.kind,
          {
            tags: { phase: event.phase },
            values: {
              covered: Number(event.covered),
              inFlight: Number(event.inFlight),
              jumpRequestId: event.requestId,
              pending: Number(event.pending),
            },
          },
          true,
        );
        break;
      case "layout":
        this.#emit(
          event.kind,
          { tags: { source: event.source }, values: { sizePx: event.sizePx } },
          false,
        );
        break;
      case "end-threshold":
        this.#emit(
          event.kind,
          { tags: {}, values: { withinThreshold: Number(event.withinThreshold) } },
          false,
        );
        break;
      case "visible-row":
        this.#emit(event.kind, { tags: {}, values: { index: event.index } }, false);
        break;
      case "lifecycle":
        this.#emit(event.kind, { tags: { phase: event.phase }, values: {} }, true);
        break;
    }
  }

  /** Compares the list's logical coordinates with the separately recorded native scroll samples. */
  listGeometry(geometry: TimelineListGeometry | null): void {
    this.#emit("list-state", { tags: {}, values: geometryValues(geometry) }, false);
  }

  #recordPolicy(policy: TimelineScrollPolicy): void {
    const previous = this.#policy;
    if (previous !== null && POLICY_KEYS.every((key) => previous[key] === policy[key])) {
      return;
    }
    if (previous?.anchorTurnId !== policy.anchorTurnId || policy.anchorReason === "none") {
      this.#anchorApplications = 0;
    }
    this.#policy = policy;
    this.#emit(
      "policy",
      {
        tags: { anchorReason: policy.anchorReason },
        values: {
          anchorIndex: policy.anchorIndex ?? -1,
          awayFromLatest: Number(policy.awayFromLatest),
          containsBeginning: Number(policy.containsBeginning),
          containsLatest: Number(policy.containsLatest),
          fullscreenCovered: Number(policy.fullscreenCovered),
          initialScrollAtEnd: Number(policy.initialScrollAtEnd),
          jumpRequestId: policy.jumpRequestId ?? -1,
          rowCount: policy.rowCount,
          scrollEnabled: Number(policy.scrollEnabled),
          searchActive: Number(policy.searchActive),
          timelinePositioned: Number(policy.timelinePositioned),
        },
      },
      true,
    );
  }

  #detectRebound(current: PhysicalScroll, now: number): boolean {
    const arrival = this.#tailArrival;
    if (arrival !== null && !this.#gestureActive && isRebound(arrival, current, now)) {
      this.#tailArrival = null;
      this.#recordRebound(arrival, current, now);
      return true;
    }
    const command = this.#endCommand;
    if (command !== null && reachedCommandEnd(command, current, now)) {
      this.#tailArrival = { ...current, at: now, commandId: command.id };
    }
    return false;
  }

  #recordRebound(arrival: TailArrival, current: PhysicalScroll, now: number): void {
    incrementMetric("timeline_scroll_rebounds");
    recordTiming("timeline_scroll_rebound_ms", now - arrival.at);
    this.#emit(
      "rebound",
      {
        tags: { source: this.#lastCommand?.source ?? "unspecified" },
        values: {
          ...current,
          arrivalCommandId: arrival.commandId,
          elapsedMs: now - arrival.at,
          fromOffsetY: arrival.offsetY,
          lastCommandId: this.#lastCommand?.id ?? 0,
        },
      },
      true,
    );
  }

  #recordCommand(
    command: ScrollCommand,
    phase: "issued" | "resolved" | "rejected",
    geometry: TimelineListGeometry | null,
  ): void {
    const target = command.target;
    this.#emit(
      "command",
      {
        tags: { phase, source: command.source, target: target.kind },
        values: {
          ...geometryValues(geometry),
          commandId: command.id,
          durationMs: performance.now() - command.startedAt,
          index: target.kind === "index" ? target.index : -1,
          offsetPx: target.kind === "offset" ? target.offset : 0,
          viewOffset: target.kind === "index" ? target.viewOffset : 0,
          viewPosition: target.kind === "index" ? target.viewPosition : 0,
        },
      },
      true,
    );
  }

  #emit(
    name: string,
    detail: { readonly tags: Record<string, string>; readonly values: Record<string, number> },
    upload: boolean,
  ): void {
    this.#journal.record(
      {
        connectionId: this.#connectionId,
        name: `chat.scroll.${name}`,
        requestId: `scroll-${String(this.#sessionId)}`,
        tags: detail.tags,
        threadId: this.#threadId,
        values: detail.values,
      },
      upload,
    );
  }
}

function distanceFromEnd(scroll: PhysicalScroll): number {
  return Math.max(0, scroll.contentHeightPx - scroll.viewportHeightPx - scroll.offsetY);
}

function isGestureReturn(active: boolean, maximumTravelPx: number, netTravelPx: number): boolean {
  return !active && maximumTravelPx > GESTURE_TRAVEL_THRESHOLD_PX && netTravelPx <= END_EPSILON_PX;
}

function isRebound(arrival: TailArrival, current: PhysicalScroll, now: number): boolean {
  return (
    now - arrival.at <= REBOUND_WINDOW_MS &&
    Math.abs(current.contentHeightPx - arrival.contentHeightPx) <= END_EPSILON_PX &&
    Math.abs(current.viewportHeightPx - arrival.viewportHeightPx) <= END_EPSILON_PX &&
    arrival.offsetY - current.offsetY >
      Math.max(REBOUND_MIN_DISTANCE_PX, current.viewportHeightPx * REBOUND_VIEWPORT_RATIO)
  );
}

function reachedCommandEnd(command: ScrollCommand, current: PhysicalScroll, now: number): boolean {
  return (
    command.target.kind === "end" &&
    now - command.startedAt <= REBOUND_WINDOW_MS &&
    distanceFromEnd(current) <= END_EPSILON_PX &&
    current.contentHeightPx > current.viewportHeightPx
  );
}

function geometryValues(geometry: TimelineListGeometry | null): Record<string, number> {
  if (geometry === null) {
    return {
      contentHeightPx: -1,
      firstIndex: -1,
      isAtEnd: -1,
      lastIndex: -1,
      listAvailable: 0,
      offsetY: -1,
      viewportHeightPx: -1,
      withinEndThreshold: -1,
    };
  }
  return {
    contentHeightPx: geometry.contentHeightPx ?? -1,
    firstIndex: geometry.firstIndex ?? -1,
    isAtEnd: diagnosticFlag(geometry.isAtEnd),
    lastIndex: geometry.lastIndex ?? -1,
    listAvailable: 1,
    offsetY: geometry.offsetY ?? -1,
    viewportHeightPx: geometry.viewportHeightPx ?? -1,
    withinEndThreshold: diagnosticFlag(geometry.withinEndThreshold),
  };
}

function diagnosticFlag(value: boolean | null): number {
  return typeof value === "boolean" ? Number(value) : -1;
}
