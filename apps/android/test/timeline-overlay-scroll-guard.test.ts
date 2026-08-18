import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createTimelineOverlayScrollGuard,
  timelineOffsetForDistanceFromEnd,
} from "../src/rendering/use-timeline-overlay-scroll-guard";
import type { ThreadTimelineListRef } from "../src/rendering/ThreadTimelineList";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const guard = readFileSync(new URL("../src/rendering/use-timeline-overlay-scroll-guard.ts", import.meta.url), "utf8");
const fullscreenOverlay = readFileSync(new URL("../src/ui/AppFullscreenOverlay.tsx", import.meta.url), "utf8");

describe("timeline overlay scroll guard", () => {
  it("returns to the new end after a keyboard inset disappears", () => {
    expect(timelineOffsetForDistanceFromEnd(2_000, 800, 0)).toBe(1_200);
  });

  it("preserves the distance from the end across viewport changes", () => {
    expect(timelineOffsetForDistanceFromEnd(2_000, 800, 240)).toBe(960);
    expect(timelineOffsetForDistanceFromEnd(2_000, 500, 240)).toBe(1_260);
  });

  it("clamps short content and invalid negative distance to the end", () => {
    expect(timelineOffsetForDistanceFromEnd(400, 800, 100)).toBe(0);
    expect(timelineOffsetForDistanceFromEnd(2_000, 800, -100)).toBe(1_200);
  });

  it("keeps the exact viewport while a native fullscreen modal steals focus", () => {
    const scheduled: Array<() => void> = [];
    const events: string[] = [];
    const offsetYRef = { current: 640 as number | null };
    const viewportHeightRef = { current: 800 };
    const contentHeightRef = { current: 2_000 };
    const distanceFromEndRef = { current: 560 };
    const freeze = {
      set(value: boolean) {
        events.push(`freeze:${value}`);
      },
    };
    const listRef: { current: ThreadTimelineListRef } = {
      current: {
        scrollToEnd: async () => undefined,
        scrollToIndex: () => undefined,
        scrollToOffset: ({ offset }: { offset: number }) => {
          events.push(`scroll:${offset}`);
        },
        reportContentInset: (inset) => {
          events.push(`inset:${inset?.bottom ?? "none"}`);
        },
      },
    };
    const controller = createTimelineOverlayScrollGuard({
      listRef,
      offsetYRef,
      viewportHeightRef,
      contentHeightRef,
      distanceFromEndRef,
      freeze,
    }, (callback) => scheduled.push(callback));
    const flush = () => {
      while (scheduled.length > 0) scheduled.shift()?.();
    };

    controller.begin("changes");
    expect(events).toEqual(["freeze:true"]);

    // This is the Android regression: mounting Modal transiently moves the
    // native list to the origin before JavaScript receives an onScroll event.
    expect(controller.observeNativeOffset(0)).toBe(true);
    contentHeightRef.current = 2_200;
    flush();
    expect(events).toEqual(["freeze:true", "scroll:640"]);
    expect(offsetYRef.current).toBe(640);

    controller.restore(false);
    flush();
    controller.end("changes");
    flush();

    expect(events).toEqual([
      "freeze:true",
      "scroll:640",
      "scroll:640",
      "inset:0",
      "scroll:640",
      "freeze:false",
    ]);
    expect(distanceFromEndRef.current).toBe(760);
  });

  it("repairs every late native focus scroll without looping at the anchor", () => {
    const scheduled: Array<() => void> = [];
    const restored: number[] = [];
    const controller = createTimelineOverlayScrollGuard({
      listRef: {
        current: {
          scrollToEnd: async () => undefined,
          scrollToIndex: () => undefined,
          scrollToOffset: ({ offset }) => restored.push(offset),
          reportContentInset: () => undefined,
        },
      },
      offsetYRef: { current: 420 },
      viewportHeightRef: { current: 500 },
      contentHeightRef: { current: 1_400 },
      distanceFromEndRef: { current: 480 },
      freeze: { set: () => undefined },
    }, (callback) => scheduled.push(callback));

    controller.begin("image-preview");
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(restored).toEqual([420]);

    expect(controller.observeNativeOffset(0)).toBe(true);
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(restored).toEqual([420, 420]);

    expect(controller.observeNativeOffset(420)).toBe(true);
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(restored).toEqual([420, 420]);
  });

  it("does not release the list until the last stacked overlay closes", () => {
    const scheduled: Array<() => void> = [];
    const freezeValues: boolean[] = [];
    const listRef: { current: ThreadTimelineListRef } = {
      current: {
        scrollToEnd: async () => undefined,
        scrollToIndex: () => undefined,
        scrollToOffset: () => undefined,
        reportContentInset: () => undefined,
      },
    };
    const controller = createTimelineOverlayScrollGuard({
      listRef,
      offsetYRef: { current: 100 },
      viewportHeightRef: { current: 400 },
      contentHeightRef: { current: 1_000 },
      distanceFromEndRef: { current: 500 },
      freeze: { set: (value) => freezeValues.push(value) },
    }, (callback) => scheduled.push(callback));

    controller.begin("changes");
    controller.begin("file");
    controller.end("changes");
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(controller.isActive()).toBe(true);
    expect(freezeValues).toEqual([true]);

    controller.end("file");
    while (scheduled.length > 0) scheduled.shift()?.();
    expect(controller.isActive()).toBe(false);
    expect(freezeValues).toEqual([true, false]);
  });

  it("wires the same overlay freeze into the actual LegendList", () => {
    expect(screen).toContain("const timelineOverlayFreeze = useSharedValue(false)");
    expect(screen).toContain("freeze: timelineOverlayFreeze");
    expect(screen).toContain("freeze={timelineOverlayFreeze}");
    expect(screen).toContain("timelineOverlay.observeNativeOffset(nativeEvent.contentOffset.y)");
    expect(guard).toContain("freeze.set(true)");
    expect(guard).toContain("reportContentInset({ bottom: 0 })");
  });

  it("guards the timeline while an attached code document owns the native modal", () => {
    expect(screen).toContain("willOpen: (id) => {");
    expect(screen).toContain("timelineOverlay.begin(id)");
    expect(screen).toContain("didOpen: () => timelineOverlay.restore(false)");
    expect(screen).toContain("didClose: (id) => timelineOverlay.end(id)");
    expect(screen).toContain('<ThreadCodeDocumentContext.Provider value={openCodeDocument}>');
    expect(screen).toContain("fullscreenOverlay.present(({ close }) => (");
    expect(fullscreenOverlay.indexOf("binding.lifecycle?.willOpen?.(id);")).toBeLessThan(fullscreenOverlay.indexOf("publish([...entriesRef.current, entry]);"));
    expect(screen).not.toContain('<ThreadCodeDocumentContext.Provider value={setCodeDocument}>');
  });
});
