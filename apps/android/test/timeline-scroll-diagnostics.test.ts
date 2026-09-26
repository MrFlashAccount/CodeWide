import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  operationalMetricsSnapshot,
  resetOperationalMetricsForTests,
} from "../src/data/operational-metrics";
import {
  configureTelemetryTransport,
  flushTelemetry,
  resetTelemetryForTests,
  setTelemetryEnabled,
  type TelemetryBatch,
} from "../src/data/telemetry";
import type { TimelineScrollPolicy } from "../src/data/timelineScrollDiagnosticContract";
import { TimelineScrollDiagnostics } from "../src/data/timelineScrollDiagnostics";
import { TimelineScrollJournal } from "../src/data/timelineScrollJournal";

beforeEach(() => {
  vi.useFakeTimers();
  resetOperationalMetricsForTests();
  resetTelemetryForTests();
});

afterEach(() => {
  resetTelemetryForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function recorder() {
  const journal = new TimelineScrollJournal();
  return {
    journal,
    diagnostics: new TimelineScrollDiagnostics("connection-1", "thread-1", journal),
  };
}

function physicalScroll(offsetY: number) {
  return { contentHeightPx: 5000, offsetY, viewportHeightPx: 600 };
}

function anchorPolicy(turnId: string): TimelineScrollPolicy {
  return {
    anchorIndex: 10,
    anchorReason: "completedResponse",
    anchorTurnId: turnId,
    awayFromLatest: false,
    containsBeginning: true,
    containsLatest: true,
    fullscreenCovered: false,
    initialScrollAtEnd: false,
    jumpRequestId: null,
    rowCount: 50,
    scrollEnabled: true,
    searchActive: false,
    timelinePositioned: true,
  };
}

describe("timeline scroll observation", () => {
  it("captures a one-frame return after reaching the end, including the intervening command", () => {
    const { diagnostics, journal } = recorder();
    const end = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.finishCommand(end, "resolved", null);
    expect(journal.snapshot().samples.some((event) => event.name === "chat.scroll.rebound")).toBe(
      false,
    );

    diagnostics.scroll(4400, 5000, 600);
    vi.advanceTimersByTime(16);
    const anchor = diagnostics.beginCommand(
      "response-start",
      { kind: "index", index: 0, viewOffset: 60, viewPosition: 0 },
      null,
    );
    diagnostics.scroll(0, 5000, 600);

    expect(journal.snapshot().lastRebound.at(-1)).toMatchObject({
      connectionId: "connection-1",
      threadId: "thread-1",
      name: "chat.scroll.rebound",
      tags: { source: "response-start" },
      values: {
        arrivalCommandId: end.id,
        lastCommandId: anchor.id,
        fromOffsetY: 4400,
        offsetY: 0,
        elapsedMs: 16,
      },
    });
    // The return must bypass the regular 250 ms sample limit.
    expect(
      journal
        .snapshot()
        .samples.filter((event) => event.name === "chat.scroll.sample")
        .map((event) => event.values.offsetY),
    ).toEqual([4400, 0]);
    expect(operationalMetricsSnapshot()).toMatchObject({
      counters: { timeline_scroll_commands: 2, timeline_scroll_rebounds: 1 },
      timings: { timeline_scroll_rebound_ms: { totalCount: 1, totalMs: 16 } },
    });
  });

  it("detects returns without a second app command without inventing a library cause", () => {
    const { diagnostics, journal } = recorder();
    const end = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.scroll(4400, 5000, 600);
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    expect(journal.snapshot().lastRebound.at(-1)?.values).toMatchObject({
      arrivalCommandId: end.id,
      lastCommandId: end.id,
    });
  });

  it("keeps observing an end command when a competing anchor is issued before the native end event", () => {
    const { diagnostics, journal } = recorder();
    const end = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    const anchor = diagnostics.beginCommand(
      "response-start",
      { kind: "index", index: 0, viewOffset: 0, viewPosition: 0 },
      null,
    );
    diagnostics.scroll(4400, 5000, 600);
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    expect(journal.snapshot().lastRebound.at(-1)?.values).toMatchObject({
      arrivalCommandId: end.id,
      lastCommandId: anchor.id,
    });
  });

  it("does not re-arm an interrupted command when a user gesture visits the end", () => {
    const { diagnostics, journal } = recorder();
    diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.scroll(4400, 5000, 600);
    diagnostics.gesture("drag-start", physicalScroll(4400));
    diagnostics.scroll(4400, 5000, 600);
    diagnostics.gesture("drag-end", physicalScroll(4400));
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    expect(journal.snapshot().lastRebound).toEqual([]);
  });

  it.each(["drag", "content-resize", "viewport-resize", "late"] as const)(
    "does not report %s as an immediate programmatic rebound",
    (scenario) => {
      const { diagnostics, journal } = recorder();
      diagnostics.beginCommand("jump-end", { kind: "end" }, null);
      diagnostics.scroll(4400, 5000, 600);
      if (scenario === "drag") diagnostics.gesture("drag-start", physicalScroll(4400));
      vi.advanceTimersByTime(scenario === "late" ? 2000 : 16);
      diagnostics.scroll(
        0,
        scenario === "content-resize" ? 5200 : 5000,
        scenario === "viewport-resize" ? 400 : 600,
      );
      expect(journal.snapshot().lastRebound).toEqual([]);
      expect(operationalMetricsSnapshot().counters.timeline_scroll_rebounds).toBeUndefined();
    },
  );

  it("does not treat a resolved command as evidence of reaching its target", () => {
    const { diagnostics, journal } = recorder();
    const end = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.finishCommand(end, "resolved", null);
    diagnostics.scroll(3000, 5000, 600);
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    expect(journal.snapshot().lastRebound).toEqual([]);
  });

  it("bounds routine sampling while keeping native gesture travel, and counts one return per gesture", () => {
    const { diagnostics, journal } = recorder();
    diagnostics.gesture("drag-start", physicalScroll(0));
    for (let frame = 0; frame < 60; frame += 1) {
      diagnostics.scroll(frame * 20, 5000, 600);
      vi.advanceTimersByTime(16);
    }
    diagnostics.scroll(0, 5000, 600);
    diagnostics.gesture("drag-end", physicalScroll(0));
    diagnostics.gesture("momentum-start", physicalScroll(0));
    diagnostics.gesture("momentum-end", physicalScroll(0));
    expect(
      journal.snapshot().samples.filter((event) => event.name === "chat.scroll.sample").length,
    ).toBeLessThanOrEqual(4);
    expect(journal.snapshot().samples.at(-1)).toMatchObject({
      tags: { phase: "momentum-end" },
      values: { returnedToStart: 1, netTravelPx: 0, travelPx: 1180 },
    });
    expect(operationalMetricsSnapshot().counters.timeline_scroll_gesture_returns).toBe(1);
    expect(journal.snapshot().lastRebound).toEqual([]);
  });

  it("does not call a stationary finger tap a stuck gesture", () => {
    const { diagnostics } = recorder();
    diagnostics.gesture("drag-start", physicalScroll(0));
    diagnostics.gesture("drag-end", physicalScroll(0));
    expect(operationalMetricsSnapshot().counters.timeline_scroll_gesture_returns).toBeUndefined();
  });

  it("deduplicates unchanged policy and distinguishes repeated application from stale rejected callbacks", () => {
    const { diagnostics, journal } = recorder();
    diagnostics.record({ kind: "policy", policy: anchorPolicy("turn-1") });
    diagnostics.record({ kind: "policy", policy: anchorPolicy("turn-1") });
    const ready = {
      kind: "anchor-ready",
      accepted: true,
      anchorIndex: 10,
      keyMatches: true,
      sizePx: 600,
    } as const;
    diagnostics.record(ready);
    diagnostics.record(ready);
    diagnostics.record({ ...ready, accepted: false, keyMatches: false });
    diagnostics.record({ kind: "policy", policy: anchorPolicy("turn-2") });
    diagnostics.record(ready);
    expect(
      journal.snapshot().samples.filter((event) => event.name === "chat.scroll.policy"),
    ).toHaveLength(2);
    expect(
      journal
        .snapshot()
        .samples.filter((event) => event.name === "chat.scroll.anchor-ready")
        .map((event) => event.values.applications),
    ).toEqual([1, 2, 2, 1]);
    expect(operationalMetricsSnapshot().counters.timeline_scroll_anchor_reapplications).toBe(1);
  });

  it("retains a bounded causal snapshot after live history eviction and another chat opens", () => {
    const { diagnostics, journal } = recorder();
    diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.scroll(4400, 5000, 600);
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    const captured = journal.snapshot();
    const another = new TimelineScrollDiagnostics("connection-2", "thread-2", journal);
    for (let index = 0; index < captured.capacity + 10; index += 1) {
      another.record({ kind: "visible-row", index });
    }
    const after = journal.snapshot();
    expect(after.samples).toHaveLength(after.capacity);
    expect(after.evictedEvents).toBe(captured.samples.length + 10);
    expect(after.samples.at(-1)?.threadId).toBe("thread-2");
    expect(after.lastRebound).toBe(captured.lastRebound);
    expect(after.lastRebound.at(-1)).toMatchObject({
      threadId: "thread-1",
      name: "chat.scroll.rebound",
    });
    expect(captured.samples.at(-1)?.threadId).toBe("thread-1");
  });

  it("uploads content-free commands with the HUD off and reserves incident capacity amid an anchor loop", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => {
      batches.push(batch);
    });
    setTelemetryEnabled(false);
    const { diagnostics, journal } = recorder();
    for (let index = 0; index < 30; index += 1) {
      diagnostics.record({
        kind: "anchor-ready",
        accepted: true,
        anchorIndex: 10,
        keyMatches: true,
        sizePx: 600,
      });
    }
    const end = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.finishCommand(end, "rejected", null);
    diagnostics.scroll(4400, 5000, 600);
    vi.advanceTimersByTime(16);
    diagnostics.scroll(0, 5000, 600);
    await flushTelemetry();
    const events = batches.flatMap((batch) => batch.events);
    // Documented transport budget: 12 routine events and a separate 2-incident allowance per second.
    expect(events.filter((event) => event.name === "chat.scroll.anchor-ready")).toHaveLength(12);
    expect(events.filter((event) => event.name === "chat.scroll.rebound")).toHaveLength(1);
    expect(journal.snapshot().suppressedUploads).toBeGreaterThan(0);
    expect(operationalMetricsSnapshot().counters.timeline_scroll_command_failures).toBe(1);
    expect(
      events.every(
        (event) =>
          event.threadId === "thread-1" && Object.values(event.values ?? {}).every(Number.isFinite),
      ),
    ).toBe(true);
    expect(events.flatMap((event) => Object.keys(event.tags ?? {}))).not.toContain("content");
    vi.advanceTimersByTime(1000);
    const next = diagnostics.beginCommand("jump-end", { kind: "end" }, null);
    diagnostics.finishCommand(next, "resolved", null);
    await flushTelemetry();
    expect(
      batches
        .flatMap((batch) => batch.events)
        .filter((event) => event.name === "chat.scroll.command")
        .map((event) => event.tags?.phase),
    ).toEqual(["issued", "resolved"]);
  });
});
