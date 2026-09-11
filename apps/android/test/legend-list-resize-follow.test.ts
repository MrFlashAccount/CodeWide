import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type ScrollOptions = { animated: boolean };

// The pinned npm package does not export its core functions. Execute the actual
// installed functions, with only native measurement/scroll/scheduler ports replaced.
// This protects observable vendor-patch behavior, not a duplicate implementation.
function declaration(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`Missing Legend List function: ${name}`);
  return source.slice(start, end + 2);
}

function fixture(bundle: string) {
  const source = readFileSync(new URL(`../node_modules/@legendapp/list/${bundle}`, import.meta.url), "utf8");
  const frames: (() => void)[] = [];
  const timers: (() => void)[] = [];
  const calls: boolean[] = [];
  const delays: number[] = [];
  const state = {
    didContainersLayout: true,
    pendingNativeMVCPAdjust: false,
    pendingMaintainScrollAtEnd: false,
    maintainingScrollAtEnd: undefined,
    scroll: 900,
    scrollLength: 100,
    sizesKnown: new Map<string, number>([["row", 100]]),
    indexByKey: new Map([["row", 0]]),
    containerItemKeys: new Set<string>(),
    startBuffered: 0,
    endBuffered: 0,
    props: { maintainScrollAtEnd: { animated: true, onItemLayout: true }, horizontal: false, data: ["row"] },
    refScroller: { current: { scrollToEnd: (options: ScrollOptions) => calls.push(options.animated) } },
  };
  const viewport = { atEnd: true };
  const measurement = { width: 100, height: 102 };
  const ctx = { state };
  const sandbox = {
    ctx, measurement,
    NATIVE_LAYOUT_MEASUREMENT_EPSILON: 1 / 3 + 0.01,
    peek$: () => viewport.atEnd,
    getContentSize: () => 1000,
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    setTimeout: (callback: () => void, delay: number) => { timers.push(callback); delays.push(delay); },
    runOrScheduleMVCPRecalculate: () => {},
    maybeUpdateAnchoredEndSpace: () => {},
    updateOtherAxisSizeIfNeeded: () => {},
    roundSize: (size: number) => size,
    updateOneItemSize: () => {
      const previous = state.sizesKnown.get("row") ?? 90;
      state.sizesKnown.set("row", measurement.height);
      return measurement.height - previous;
    },
  };
  const program = ["isWithinEpsilon", "isNativeLayoutNoise", "doMaintainScrollAtEnd", "applyItemSize", "flushItemSizeUpdates"]
    .map((name) => declaration(source, name)).join("\n");
  function execute(command: string) { runInNewContext(`${program}\n${command}`, sandbox); }
  function resize() { execute('flushItemSizeUpdates(ctx, applyItemSize(ctx, "row", measurement));'); }
  function follow() { execute("doMaintainScrollAtEnd(ctx);"); }
  return { state, viewport, measurement, frames, timers, calls, delays, resize, follow };
}

describe.each(["react-native.js", "react-native.mjs"])("Legend List resize follow: %s", (bundle) => {
  it("follows a small row expansion immediately without animation or another frame", () => {
    const f = fixture(bundle);
    f.resize();
    expect(f.calls).toEqual([false]);
    expect(f.frames).toHaveLength(0);
    expect(f.delays).toEqual([0]);
  });

  it("follows a large expansion in the same call", () => {
    const f = fixture(bundle);
    f.measurement.height = 200;
    f.resize();
    expect(f.calls).toEqual([false]);
    expect(f.frames).toHaveLength(0);
  });

  it("preserves following the first measured size", () => {
    const f = fixture(bundle);
    f.state.sizesKnown.clear();
    f.resize();
    expect(f.calls).toEqual([false]);
  });

  it("does not follow native measurement noise", () => {
    const f = fixture(bundle);
    f.measurement.height = 100.1;
    f.resize();
    expect(f.calls).toEqual([]);
    expect(f.frames).toHaveLength(0);
  });

  it("keeps ordinary follow scheduled and uses the configured animation", () => {
    const f = fixture(bundle);
    f.follow();
    expect(f.calls).toEqual([]);
    expect(f.frames).toHaveLength(1);
    f.frames.shift()?.();
    expect(f.calls).toEqual([true]);
    expect(f.delays).toEqual([500]);
  });

  it("does not move a reader away from history", () => {
    const f = fixture(bundle);
    f.viewport.atEnd = false;
    f.resize();
    expect(f.calls).toEqual([]);
    expect(f.frames).toHaveLength(0);
  });

  it("respects item-layout opt-out", () => {
    const f = fixture(bundle);
    f.state.props.maintainScrollAtEnd.onItemLayout = false;
    f.resize();
    expect(f.calls).toEqual([]);
    expect(f.frames).toHaveLength(0);
  });

  it("waits for outstanding native MVCP adjustment", () => {
    const f = fixture(bundle);
    f.state.pendingNativeMVCPAdjust = true;
    f.resize();
    expect(f.calls).toEqual([]);
    expect(f.frames).toHaveLength(0);
    expect(f.state.pendingMaintainScrollAtEnd).toBe(true);
  });

  it("cancels a scheduled follow when the reader scrolls away", () => {
    const f = fixture(bundle);
    f.follow();
    f.state.scroll = 500;
    f.viewport.atEnd = false;
    f.frames.shift()?.();
    expect(f.calls).toEqual([]);
    expect(f.state.maintainingScrollAtEnd).toBeUndefined();
  });

  it("coalesces repeated resize requests and releases the instant follow", () => {
    const f = fixture(bundle);
    f.resize();
    f.measurement.height = 104;
    f.resize();
    expect(f.calls).toEqual([false]);
    f.timers.shift()?.();
    expect(f.calls).toEqual([false, false]);
    expect(f.frames).toHaveLength(0);
    f.timers.shift()?.();
    expect(f.state.maintainingScrollAtEnd).toBeUndefined();
    expect(f.state.pendingMaintainScrollAtEnd).toBe(false);
  });
});
