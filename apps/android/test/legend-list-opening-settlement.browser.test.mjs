import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const requireLegend = createRequire(requireAndroid.resolve("@legendapp/list/react-native"));
const { build } = requireAndroid("esbuild");
const legendDirectory =
  process.env.CODEWIDE_LEGEND_PROBE_PACKAGE ??
  fileURLToPath(new URL("../node_modules/@legendapp/list/", import.meta.url));
const scripts = new Map();
let browser;

async function buildProbe(platform, extension) {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    stdin: {
      contents: `
import React, { useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import { TimelineResponseStart } from "./src/features/conversation/timeline/timelineResponseStart";
import { TimelineScrollDiagnostics } from "./src/data/timelineScrollDiagnostics";

const HEIGHT = 848;
const TOP = 62;
const BOTTOM = 108;
const configuration = window.configuration;
const ANSWER_HEIGHT = configuration.answerHeight ?? (configuration.response === "long" ? 1800 : 180);
const history = Array.from({ length: configuration.progressiveHydration ? 82 : configuration.measurementReflow ? 58 : configuration.residentChange ? 48 : 53 }, (_, index) => ({
  id: "history-" + index,
  height: configuration.measurementReflow ? (configuration.historyHeight ?? 2400) : index % 7 === 0 ? 680 : index % 3 === 0 ? 320 : 110,
}));
const answer = { id: "answer", height: ANSWER_HEIGHT };
const user = { id: "user", height: 80 };
const inserted = Array.from({ length: 5 }, (_, index) => ({ id: "inserted-" + index, height: 110 }));
const continuation = configuration.progressiveHydration
  ? Array.from({ length: 13 }, (_, index) => ({ id: "continuation-" + index, height: 30 }))
  : configuration.measurementReflow
  ? Array.from({ length: 11 }, (_, index) => ({ id: "continuation-" + index, height: 90 }))
  : configuration.response === "sliced"
  ? Array.from({ length: 6 }, (_, index) => ({ id: "continuation-" + index, height: 300 }))
  : [];
const diagnostics = new TimelineScrollDiagnostics("opening-probe", "thread");
window.openingFrames = [];
window.readyAt = null;
window.openingEvents = [];
window.transitionSamples = [];
window.mutateOnDispatch = false;
window.requestSettled = false;
window.commands = [];
window.adjustments = [];
window.measurementScale = 1;
const measurementListeners = new Set();
window.measureHistory = scale => {
  window.measurementScale = scale;
  for (const listener of measurementListeners) listener(scale);
};

function MeasuredRow({ item }) {
  const [scale, setScale] = useState(window.measurementScale);
  useLayoutEffect(() => {
    measurementListeners.add(setScale);
    return () => measurementListeners.delete(setScale);
  }, []);
  const height = item.id.startsWith("history-") ? item.height * scale : item.height;
  return <View testID={item.id} style={{ height, backgroundColor: "#333" }} />;
}

function NativeScroll({ contentOffset, ref, ...props }) {
  const scrollRef = useRef(null);
  const last = useRef(undefined);
  const flushAdjustment = useRef(() => {});
  window.beginDrag = () => props.onScrollBeginDrag?.({ nativeEvent: {} });
  window.endDrag = () => props.onScrollEndDrag?.({ nativeEvent: {} });
  useImperativeHandle(ref, () => ({
    getNativeScrollRef: () => scrollRef.current,
    getScrollableNode: () => scrollRef.current.getScrollableNode(),
    getScrollResponder: () => scrollRef.current,
    measure: callback => scrollRef.current.measure(callback),
    measureInWindow: callback => scrollRef.current.measureInWindow(callback),
    scrollTo: options => {
      // Mount-item geometry/MVCP precedes a subsequent explicit native command.
      flushAdjustment.current();
      scrollRef.current.scrollTo(options);
      window.onNativeCommand?.();
    },
  }), []);
  useLayoutEffect(() => {
    const viewport = scrollRef.current?.getScrollableNode();
    const anchor = viewport?.firstElementChild?.firstElementChild;
    if (!anchor || !props.maintainVisibleContentPosition) return;
    // RN's native MVCP preserves the first qualifying direct child's frame delta.
    // LegendList puts its zero-sized ScrollAdjust sentinel before the row containers.
    // react-native-web ignores MVCP; model this native contract before browser paint.
    let previousTop = anchor.getBoundingClientRect().top + viewport.scrollTop;
    flushAdjustment.current = () => {
      const top = anchor.getBoundingClientRect().top + viewport.scrollTop;
      viewport.scrollTop += top - previousTop;
      previousTop = top;
    };
    const observer = new MutationObserver(() => flushAdjustment.current());
    observer.observe(anchor, { attributes: true, attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
      flushAdjustment.current = () => {};
    };
  }, []);
  useLayoutEffect(() => {
    if (last.current !== contentOffset?.y) {
      last.current = contentOffset?.y;
      scrollRef.current?.scrollTo({ animated: false, y: contentOffset?.y ?? 0 });
    }
  });
  // Native throttle=0 delivers every frame. RN Web's 0 only emits the first
  // event and a trailing event 100 ms later; it would hide intermediate offsets.
  return <ScrollView {...props} scrollEventThrottle={1} testID="viewport" ref={scrollRef} />;
}

function Probe() {
  const ref = useRef(null);
  const [positioned, setPositioned] = useState(false);
  const [stage, setStage] = useState(0);
  const [request] = useState(() => new TimelineResponseStart("initialUnread", "turn"));
  const unread = configuration.unread;
  const removeStart = configuration.removeTarget ? 38 : 28;
  const removeCount = configuration.residentChange ? 4 : 5;
  const rows = stage === 1 && configuration.mutation === "empty" ? [] : [
    ...(stage > 0 && configuration.mutation === "insert" ? inserted : []),
    ...history.filter((_, index) => stage === 0 || configuration.mutation !== "remove" || index < removeStart || index >= removeStart + removeCount),
    user,
    answer,
    ...((configuration.measurementReflow || configuration.progressiveHydration) && stage === 0 ? [] : continuation),
    ...(configuration.residentChange ? [{ id: stage > 0 && configuration.mutation === "replace-tail" ? "replacement-tail" : "tail", height: 40 }] : []),
    ...(stage > 0 && configuration.mutation === "append" ? inserted : []),
  ];
  const anchor = { index: rows.findIndex(row => row.id === answer.id), key: answer.id };
  window.reproject = () => setStage(1);
  window.restore = () => setStage(2);
  window.onNativeCommand = () => {
    if (window.mutateOnDispatch) {
      window.mutateOnDispatch = false;
      setStage(1);
    }
    if (stage === 0 && configuration.afterDispatch) setStage(1);
  };
  window.jumpToEnd = () => ref.current.scrollToEnd({ animated: false });
  window.reprojectDuringScroll = target => {
    window.mutateOnDispatch = true;
    window.transitionSamples = [];
    window.requestSettled = false;
    const promise = target === "end"
      ? ref.current.scrollToEnd({ animated: false })
      : ref.current.scrollToIndex({ animated: false, index: rows.findIndex(row => row.id === "history-40"), viewPosition: 0.5 });
    promise.then(() => { window.requestSettled = true; });
  };
  window.snapshot = () => {
    const viewport = document.querySelector('[data-testid="viewport"]');
    const response = document.querySelector('[data-testid="answer"]');
    const state = ref.current?.getState();
    let revealed = response !== null;
    for (let node = response; revealed && node && node !== viewport; node = node.parentElement) {
      const style = getComputedStyle(node);
      revealed = style.opacity !== "0" && style.visibility !== "hidden" && style.display !== "none";
    }
    return {
      top: response && viewport ? response.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null,
      scroll: viewport?.scrollTop ?? 0,
      distance: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
      logicalScroll: state?.scroll,
      contentLength: state?.contentLength,
      rowCount: state?.data.length,
      targetTop: (() => {
        const target = document.querySelector('[data-testid="history-40"]');
        return target && viewport ? target.getBoundingClientRect().top - viewport.getBoundingClientRect().top : null;
      })(),
      stage,
      measurementScale: window.measurementScale,
      revealed,
      expectedTop: unread && configuration.response !== "short" ? TOP : HEIGHT - BOTTOM - ANSWER_HEIGHT - (configuration.residentChange ? 40 : 0) - (stage > 0 && configuration.mutation === "append" ? 550 : 0),
      ready: window.readyAt !== null,
      at: performance.now(),
    };
  };
  useLayoutEffect(() => {
    if (!configuration.residentChange) return;
    return ref.current.getState().listen("totalSize", () => {
      window.transitionSamples.push(window.snapshot());
    });
  }, []);
  return <View style={{ height: HEIGHT, opacity: positioned ? 1 : 0, width: 420 }}>
    <LegendList
      alignItemsAtEnd
      anchoredEndSpace={unread ? request.anchorSpace({
        anchor, bottomInset: BOTTOM, diagnostics, getList: () => null,
        maxViewportHeight: HEIGHT, offset: TOP, topInset: 56,
      }) : undefined}
      contentContainerStyle={{ paddingTop: TOP, paddingBottom: BOTTOM }}
      data={rows}
      drawDistance={configuration.measurementReflow ? 1000 : 250}
      estimatedItemSize={configuration.measurementReflow ? (configuration.historyHeight ?? 2400) : 280}
      getFixedItemSize={configuration.measurementReflow
        ? item => item.id.startsWith("history-") ? undefined : item.height
        : configuration.measured ? undefined : item => item.height}
      initialScrollAtEnd={!unread && !positioned}
      initialScrollIndex={unread && (!positioned || configuration.retainInitialIndex) ? request.initialPosition(anchor, TOP) : undefined}
      keyExtractor={item => item.id}
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.02}
      maintainVisibleContentPosition
      onContentSizeChange={(_width, height) => {
        window.openingEvents.push({ kind: "content", height, stage, ready: window.readyAt !== null });
        // Cached -> hydrated projection changes while LegendList still owns bootstrap.
        // The response key survives; its physical index moves with preceding rows.
        if (stage === 0 && height > 0 && !configuration.manual && !configuration.afterDispatch) setStage(1);
      }}
      onReady={() => {
        if (window.readyAt !== null) return;
        window.readyAt = performance.now();
        setPositioned(true);
        if (configuration.openingReflow) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            window.measureHistory(0.45);
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (configuration.secondMeasurement) window.measureHistory(0.3);
              setStage(1);
            }));
          }));
        }
        if (configuration.hydrateAfterLoad) setTimeout(() => setStage(1), 70);
      }}
      onScrollDiagnostic={event => {
        if (event.phase === "adjustment") {
          window.adjustments.push(event);
          if (configuration.throwAdjustmentObserver) throw new Error("probe observer failure");
        } else window.commands.push(event);
      }}
      recycleItems={false}
      onScrollBeginDrag={() => request.cancel()}
      scrollEventThrottle={16}
      ref={ref}
      renderItem={({ item }) => configuration.measurementReflow
        ? <MeasuredRow item={item} />
        : <View testID={item.id} style={{ height: item.height, backgroundColor: "#333" }} />}
      renderScrollComponent={NativeScroll}
    />
  </View>;
}

let samples = 0;
function sample() {
  if (window.snapshot) {
    const snapshot = window.snapshot();
    if (snapshot.revealed || window.openingFrames.length > 0) window.openingFrames.push(snapshot);
  }
  samples += 1;
  if (samples < 40) requestAnimationFrame(sample);
  else window.finished = true;
}
requestAnimationFrame(sample);
createRoot(document.getElementById("root")).render(<Probe />);
`,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      sourcefile: "legend-list-opening-settlement-probe.tsx",
    },
    alias: {
      "@legendapp/list/react-native": join(legendDirectory, "react-native." + extension),
      "use-sync-external-store/shim": requireLegend.resolve("use-sync-external-store/shim"),
    },
    nodePaths: [fileURLToPath(new URL("../node_modules/", import.meta.url))],
    plugins: [
      {
        name: "native-platform-with-dom-layout",
        setup(builder) {
          builder.onResolve({ filter: /^react-native$/ }, () => ({
            path: "native",
            namespace: "probe",
          }));
          builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
            contents: `export * from "react-native-web";
import { Platform as WebPlatform } from "react-native-web";
export const Platform = { ...WebPlatform, OS: "${platform}", select: values => values.${platform} ?? values.native ?? values.default };`,
            resolveDir: fileURLToPath(new URL("../", import.meta.url)),
          }));
        },
      },
    ],
    bundle: true,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false", global: "globalThis" },
    format: "iife",
    logLevel: "silent",
    platform: "browser",
    write: false,
  });
  return result.outputFiles[0].text;
}

before(async () => {
  for (const platform of ["web", "android"]) {
    for (const extension of ["js", "mjs"]) {
      scripts.set(platform + ":" + extension, await buildProbe(platform, extension));
    }
  }
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function openProbe(platform, extension, configuration) {
  const page = await browser.newPage({ viewport: { height: 1000, width: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate((configuration) => {
    window.configuration = configuration;
    window.nativeFabricUIManager = {};
  }, configuration);
  await page.addScriptTag({ content: scripts.get(platform + ":" + extension) });
  await page.waitForFunction(() => window.finished === true);
  assert.deepEqual(errors, []);
  return { page, errors };
}

for (const platform of ["web", "android"]) {
  for (const extension of ["js", "mjs"]) {
    for (const scenario of platform === "android"
      ? [
          { answerHeight: 180, throwAdjustmentObserver: false },
          { answerHeight: 720, throwAdjustmentObserver: false },
          { answerHeight: 900, throwAdjustmentObserver: false },
          { answerHeight: 1800, throwAdjustmentObserver: false },
          { answerHeight: 180, throwAdjustmentObserver: true },
        ]
      : []) {
      const { answerHeight, throwAdjustmentObserver } = scenario;
      test(`${platform}/${extension}: 84-to-97 progressive hydration keeps the unread start visible (${answerHeight}, ${throwAdjustmentObserver ? "throwing" : "recording"} observer)`, async () => {
        const { page } = await openProbe(platform, extension, {
          answerHeight,
          manual: true,
          measured: true,
          historyHeight: 280,
          measurementReflow: true,
          openingReflow: true,
          progressiveHydration: true,
          response: answerHeight < 740 ? "short" : "long",
          throwAdjustmentObserver,
          unread: true,
        });
        try {
          const result = await page.evaluate(() => ({
            frames: window.openingFrames,
            commands: window.commands,
            adjustments: window.adjustments,
          }));
          assert.ok(result.frames.some((frame) => frame.rowCount === 84));
          assert.ok(result.frames.some((frame) => frame.rowCount === 97));
          const misplaced = result.frames.filter(
            (frame) => !frame.revealed || frame.top < 56 || frame.top >= 848 - 108,
          );
          assert.deepEqual(misplaced, [], JSON.stringify({ misplaced, commands: result.commands }));
          // Reflow above preserves the response start. Appending below may move it up
          // to follow the tail, but cannot first move it down and then bounce back.
          const backward = result.frames.filter(
            (frame, index, frames) => index > 0 && frame.top > frames[index - 1].top + 1,
          );
          assert.deepEqual(backward, [], JSON.stringify({ backward, commands: result.commands }));
          assert.ok(result.adjustments.some((event) => event.requestedDeltaPx !== 0));
          for (const event of result.adjustments) {
            // This probe has no user scroll-offset override; the committed native
            // sentinel delta must account for the requested delta and range clamp.
            assert.ok(
              Math.abs(event.sentinelDeltaPx - event.requestedDeltaPx - event.clampCompensationPx) <
                0.001,
            );
          }
        } finally {
          await page.close();
        }
      });
    }
    // This models Android's native range clamp before native MVCP, not web scroll anchoring.
    for (const scenario of platform === "android"
      ? [
          { answerHeight: 900 },
          { answerHeight: 1800 },
          { answerHeight: 900, secondMeasurement: true },
        ]
      : []) {
      test(`${platform}/${extension}: 60-to-71 opening preserves every frame across measured height contraction (${scenario.answerHeight}, ${scenario.secondMeasurement ? "repeated" : "single"})`, async () => {
        const { page, errors } = await openProbe(platform, extension, {
          ...scenario,
          manual: true,
          measured: true,
          measurementReflow: true,
          openingReflow: true,
          unread: true,
        });
        try {
          const frames = await page.evaluate(() => window.openingFrames);
          assert.ok(frames.length >= 20);
          assert.ok(frames.some((frame) => frame.rowCount === 60));
          assert.ok(frames.some((frame) => frame.rowCount === 71));
          const misplaced = frames.filter(
            (frame) => !frame.revealed || frame.top < 56 || frame.top >= 848 - 108,
          );
          assert.equal(
            misplaced.length,
            0,
            JSON.stringify({ first: frames[0], misplaced: misplaced.slice(0, 5) }),
          );
          const jumps = frames.filter((frame) => Math.abs(frame.top - frames[0].top) > 1);
          assert.equal(
            jumps.length,
            0,
            JSON.stringify({ first: frames[0], jumps: jumps.slice(0, 5) }),
          );
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
    for (const progressiveHydration of platform === "android" ? [false, true] : [false]) {
      const expectedRowCount = progressiveHydration ? 97 : 71;
      test(`${platform}/${extension}: hydration to ${expectedRowCount} rows does not reclaim manual scrolling`, async () => {
        const { page, errors } = await openProbe(platform, extension, {
          answerHeight: 900,
          historyHeight: progressiveHydration ? 280 : 2400,
          manual: true,
          measured: true,
          measurementReflow: true,
          progressiveHydration,
          unread: true,
        });
        try {
          const result = await page.evaluate(async () => {
            const viewport = document.querySelector('[data-testid="viewport"]');
            window.beginDrag();
            viewport.scrollTop -= 4000;
            for (let index = 0; index < 8; index++) await new Promise(requestAnimationFrame);
            window.endDrag();
            const commands = window.commands.length;
            window.measureHistory(0.45);
            const frames = [];
            for (let index = 0; index < 24; index++) {
              await new Promise(requestAnimationFrame);
              frames.push(window.snapshot());
              if (index === 1) window.reproject();
            }
            return { frames, commands: window.commands.slice(commands) };
          });
          assert.equal(result.frames.at(-1).rowCount, expectedRowCount);
          assert.ok(
            result.frames.every((frame) => frame.distance > 848),
            JSON.stringify(result),
          );
          assert.deepEqual(
            result.commands,
            [],
            "measurement and hydration cannot issue a scroll command after a drag",
          );
          await page.evaluate(() => window.jumpToEnd());
          await expect
            .poll(() => page.evaluate(() => window.snapshot().distance))
            .toBeLessThanOrEqual(1);
          assert.deepEqual(errors, []);
        } finally {
          await page.close();
        }
      });
    }
    for (const mutation of ["remove", "insert"]) {
      for (const scenario of [
        { response: "short", unread: false },
        { response: "short", unread: true },
        { response: "long", unread: true },
        { response: "sliced", unread: true },
        { afterDispatch: true, response: "short", unread: true },
        { afterDispatch: true, response: "long", unread: true },
        ...(mutation === "remove" ? [{ measured: true, response: "short", unread: true }] : []),
      ]) {
        test(`${platform}/${extension}: ${mutation} history ${scenario.afterDispatch ? "during native dispatch" : "before opening"} ${scenario.unread ? "unread" : "read"} ${scenario.response} response (${scenario.measured ? "estimated sizes" : "known sizes"})`, async () => {
          const { page, errors } = await openProbe(platform, extension, { ...scenario, mutation });
          try {
            const { frames, events } = await page.evaluate(() => ({
              frames: window.openingFrames,
              events: window.openingEvents,
            }));
            assert.ok(
              events.some((event) => event.stage === 1 && !event.ready),
              "projection must change before initial positioning finishes",
            );
            assert.ok(frames.length >= 20, JSON.stringify({ errors, frames }));
            // A short unread answer stays at the natural tail because it is already fully visible.
            // Long and sliced answers need their start inside the usable viewport.
            const misplaced = frames.filter((frame) =>
              scenario.response === "short"
                ? Math.abs(frame.top - frame.expectedTop) > 1
                : frame.top < 56 || frame.top >= 848 - 108,
            );
            assert.equal(
              misplaced.length,
              0,
              JSON.stringify({ errors, misplaced: misplaced.slice(0, 5), events }),
            );
            const firstTop = frames[0].top;
            const jumps = frames.filter((frame) => Math.abs(frame.top - firstTop) > 1);
            assert.equal(
              jumps.length,
              0,
              JSON.stringify({ firstTop, jumps: jumps.slice(0, 5), events }),
            );
            assert.deepEqual(errors, []);
          } finally {
            await page.close();
          }
        });
      }
    }
    test(`${platform}/${extension}: a retained initial index cannot reclaim scrolling after opening`, async () => {
      const { page, errors } = await openProbe(platform, extension, {
        manual: true,
        mutation: "remove",
        response: "short",
        retainInitialIndex: true,
        unread: true,
      });
      try {
        await page.evaluate(async () => {
          const viewport = document.querySelector('[data-testid="viewport"]');
          viewport.scrollTop -= 1600;
          for (let index = 0; index < 8; index++) await new Promise(requestAnimationFrame);
          window.reproject();
          for (let index = 0; index < 20; index++) await new Promise(requestAnimationFrame);
        });
        const manual = await page.evaluate(() => window.snapshot());
        assert.equal(manual.stage, 1);
        assert.ok(manual.scroll > 0 && manual.distance > 848, JSON.stringify(manual));
        await page.evaluate(async () => {
          await window.jumpToEnd();
          for (let index = 0; index < 8; index++) await new Promise(requestAnimationFrame);
        });
        const tail = await page.evaluate(() => window.snapshot());
        assert.ok(Math.abs(tail.top - tail.expectedTop) <= 1, JSON.stringify(tail));
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
    for (const target of ["end", "item"]) {
      for (const mutation of [
        "remove",
        "insert",
        ...(target === "end" ? ["append", "replace-tail"] : []),
      ]) {
        test(`${platform}/${extension}: active ${target} target survives resident ${mutation}`, async () => {
          const { page, errors } = await openProbe(platform, extension, {
            manual: true,
            measured: true,
            mutation,
            residentChange: true,
            response: "short",
            unread: true,
          });
          try {
            const result = await page.evaluate(async (target) => {
              window.reprojectDuringScroll(target);
              const frames = [];
              for (let index = 0; index < 24; index++) {
                await new Promise(requestAnimationFrame);
                frames.push(window.snapshot());
              }
              return { frames, samples: window.transitionSamples };
            }, target);
            await expect.poll(() => page.evaluate(() => window.requestSettled)).toBe(true);
            assert.ok(
              result.samples.some((sample) => sample.stage === 1),
              "changed rows must be observed",
            );
            // Every synthetic row is at least 40 units high. Removing four rows from a
            // multi-screen transcript cannot legitimately collapse its entire scroll range.
            const collapsed = result.samples.filter(
              (sample) => sample.contentLength < sample.rowCount * 40,
            );
            assert.deepEqual(collapsed, [], JSON.stringify({ collapsed, errors }));
            const final = await page.evaluate(() => window.snapshot());
            if (target === "end") {
              assert.ok(Math.abs(final.distance) <= 1, JSON.stringify(result));
              assert.ok(Math.abs(final.top - final.expectedTop) <= 1, JSON.stringify(result));
              if (mutation === "remove" || mutation === "replace-tail") {
                const misplaced = result.frames.filter(
                  (frame) =>
                    frame.stage === 1 &&
                    (!frame.revealed || Math.abs(frame.top - frame.expectedTop) > 1),
                );
                assert.deepEqual(misplaced, [], JSON.stringify({ misplaced, errors }));
              }
            } else {
              const centeredTop = (848 - 110) / 2;
              assert.ok(
                final.targetTop !== null && Math.abs(final.targetTop - centeredTop) <= 1,
                JSON.stringify(result),
              );
            }
            assert.deepEqual(errors, []);
          } finally {
            await page.close();
          }
        });
      }
    }
    test(`${platform}/${extension}: removal of an active item target settles and releases scrolling`, async () => {
      const { page, errors } = await openProbe(platform, extension, {
        manual: true,
        measured: true,
        mutation: "remove",
        removeTarget: true,
        residentChange: true,
        response: "short",
        unread: true,
      });
      try {
        await page.evaluate(() => window.reprojectDuringScroll("item"));
        await expect.poll(() => page.evaluate(() => window.requestSettled)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.snapshot().rowCount)).toBe(47);
        const samples = await page.evaluate(() => window.transitionSamples);
        assert.ok(samples.some((sample) => sample.stage === 1));
        assert.ok(samples.every((sample) => sample.contentLength >= sample.rowCount * 40));
        await page.evaluate(() => window.jumpToEnd());
        await expect
          .poll(() => page.evaluate(() => window.snapshot().distance))
          .toBeLessThanOrEqual(1);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
    test(`${platform}/${extension}: an empty snapshot cancels the active end target without blocking later requests`, async () => {
      const { page, errors } = await openProbe(platform, extension, {
        manual: true,
        measured: true,
        mutation: "empty",
        residentChange: true,
        response: "short",
        unread: true,
      });
      try {
        await page.evaluate(() => window.reprojectDuringScroll("end"));
        await expect.poll(() => page.evaluate(() => window.requestSettled)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.snapshot().rowCount)).toBe(0);
        await page.evaluate(() => window.restore());
        await expect.poll(() => page.evaluate(() => window.snapshot().rowCount)).toBe(51);
        await page.evaluate(() => window.jumpToEnd());
        await expect
          .poll(() => page.evaluate(() => window.snapshot().distance))
          .toBeLessThanOrEqual(1);
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
    test(`${platform}/${extension}: unread history hydration after readiness never collapses the resident scroll range`, async () => {
      const { page, errors } = await openProbe(platform, extension, {
        hydrateAfterLoad: true,
        manual: true,
        measured: true,
        mutation: "remove",
        residentChange: true,
        response: "short",
        unread: true,
      });
      try {
        const result = await page.evaluate(() => ({
          samples: window.transitionSamples,
          final: window.snapshot(),
        }));
        assert.ok(result.samples.some((sample) => sample.ready && sample.stage === 1));
        assert.ok(
          result.samples.every((sample) => sample.contentLength >= sample.rowCount * 40),
          JSON.stringify(result),
        );
        assert.ok(
          result.final.revealed && Math.abs(result.final.top - result.final.expectedTop) <= 1,
          JSON.stringify(result),
        );
        assert.deepEqual(errors, []);
      } finally {
        await page.close();
      }
    });
  }
}
