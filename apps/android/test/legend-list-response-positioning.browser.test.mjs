import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
const legendListNativeEntry = fileURLToPath(
  new URL("../node_modules/@legendapp/list/react-native.js", import.meta.url),
);

let browser;
let probeScript;

before(async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    stdin: {
      contents: `
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import { TimelineScrollDiagnostics } from "./src/data/timelineScrollDiagnostics";
import { timelineScrollJournal } from "./src/data/timelineScrollJournal";
import { observeTimelineScrollCommand, useTimelineListDiagnostics } from "./src/rendering/timelineListDiagnostics";
import { TimelineResponseStart } from "./src/features/conversation/timeline/timelineResponseStart";

const AGENT_KEY = "response-agent";
const RESPONSE_START_OFFSET = 64;
const VIEWPORT_HEIGHT = 360;
const historyRows = Array.from({ length: 12 }, (_, index) => ({
  height: 80,
  id: "history-" + String(index),
  kind: "history",
}));
const userRow = { height: 96, id: "response-user", kind: "user" };
const streamingAgentRow = { height: 0, id: AGENT_KEY, kind: "streaming-agent" };
const streamingRows = [...historyRows, userRow, streamingAgentRow];
const completedAgentRows = Array.from({ length: 30 }, (_, index) => ({
  height: 150,
  id: index === 0 ? AGENT_KEY : AGENT_KEY + "-slice-" + String(index),
  kind: "agent",
}));
const completedRows = [...historyRows, userRow, ...completedAgentRows];

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function settleLayout() {
  await nextFrame();
  await nextFrame();
}

function ProbeScrollView(props) {
  return <ScrollView {...props} testID="probe-scroll" />;
}

function Probe() {
  const initialUnread = window.initialUnread === true;
  const singleLongRow = window.singleLongRow === true;
  const listRef = useRef(null);
  const [diagnostics] = useState(() => new TimelineScrollDiagnostics("probe", "response"));
  const diagnosticHandlers = useTimelineListDiagnostics(diagnostics, listRef, {});
  const [agentHeight, setAgentHeight] = useState(singleLongRow ? 5200 : initialUnread ? 1200 : 120);
  const [anchor, setAnchor] = useState(initialUnread ? AGENT_KEY : null);
  const [request, setRequest] = useState(() => initialUnread ? new TimelineResponseStart("initialUnread", AGENT_KEY) : null);
  const [completed, setCompleted] = useState(initialUnread);
  const [lateSliceGrowth, setLateSliceGrowth] = useState(0);
  const rows = singleLongRow
    ? [...historyRows.slice(0, 2), userRow, { height: 5400, id: AGENT_KEY, kind: completed ? "agent" : "streaming-agent" }]
    : completed ? completedRows : streamingRows;
  const anchorIndex = rows.findIndex((row) => row.id === anchor);
  const listAdapter = {
    indexForItemKey: key => listRef.current?.getState().indexByKey(key) ?? null,
    scrollToIndex: async options => observeTimelineScrollCommand({
      diagnostics, ref: listRef, source: "response-start",
      target: { kind: "index", index: options.index, viewOffset: options.viewOffset, viewPosition: options.viewPosition },
    }, () => listRef.current.scrollToIndex(options)),
  };
  const anchorSpace = request?.anchorSpace({
    anchor: { index: anchorIndex, key: AGENT_KEY },
    diagnostics,
    getList: () => listRef.current === null ? null : listAdapter,
    offset: RESPONSE_START_OFFSET,
  });

  function responseGeometry() {
    const response = document.querySelector('[data-testid="agent-response"]');
    const viewport = document.querySelector('[data-testid="probe-scroll"]');
    if (response === null || viewport === null) {
      return null;
    }
    const responseBounds = response.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    return {
      bottom: responseBounds.bottom - viewportBounds.top,
      top: responseBounds.top - viewportBounds.top,
      visible:
        responseBounds.bottom > viewportBounds.top && responseBounds.top < viewportBounds.bottom,
    };
  }

  function snapshot() {
    const state = listRef.current?.getState();
    const scroller = document.querySelector('[data-testid="probe-scroll"]');
    const physicalDistanceFromEnd =
      scroller === null ? -1 : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    return {
      agent: responseGeometry(),
      atEnd: state?.isAtEnd ?? false,
      physicalAtEnd: physicalDistanceFromEnd >= 0 && physicalDistanceFromEnd <= 1,
      physicalDistanceFromEnd,
      scroll: state?.scroll ?? 0,
      streaming: !completed,
    };
  }

  async function forceAnchor() {
    const options = {
      animated: false,
      index: anchorIndex,
      viewOffset: RESPONSE_START_OFFSET,
      viewPosition: 0,
    };
    await observeTimelineScrollCommand({
      diagnostics, ref: listRef, source: "response-start",
      target: { kind: "index", index: anchorIndex, viewOffset: RESPONSE_START_OFFSET, viewPosition: 0 },
    }, () => listRef.current.scrollToIndex(options));
    await settleLayout();
  }

  window.probe = {
    diagnosticReport: () => timelineScrollJournal.snapshot(),
    async diagnosticJumpToEnd() {
      await observeTimelineScrollCommand({
        diagnostics, ref: listRef, source: "jump-end", target: { kind: "end" },
      }, () => listRef.current.scrollToEnd({ animated: false }));
      await settleLayout();
      return snapshot();
    },
    // Fault injection: replay a competing anchor after a real bottom arrival. This tests
    // diagnostic coverage, not whether the Android bug naturally follows this exact path.
    async replayAnchor() {
      await forceAnchor();
      return snapshot();
    },
    async repeatReady() {
      anchorSpace?.onReady({ anchorIndex, anchorKey: anchor, size: 0 });
      await settleLayout();
      return snapshot();
    },
    async manualEnd() {
      request?.cancel();
      setRequest(null);
      setAnchor(null);
      await settleLayout();
      const element = document.querySelector('[data-testid="probe-scroll"]');
      element.scrollTop = element.scrollHeight;
      await settleLayout();
      return snapshot();
    },
    async complete() {
      const shouldAnchor = listRef.current.getState().isWithinMaintainScrollAtEndThreshold;
      setCompleted(true);
      if (shouldAnchor) {
        setAnchor(AGENT_KEY);
        setRequest(new TimelineResponseStart("completedResponse", AGENT_KEY));
      }
      await settleLayout();
      await settleLayout();
      return snapshot();
    },
    async growStream() {
      setAgentHeight((height) => height + 180);
      await settleLayout();
      await settleLayout();
      return snapshot();
    },
    async growLateCompletedSlice() {
      setLateSliceGrowth(420);
      await settleLayout();
      await settleLayout();
      return snapshot();
    },
    async scrollAway() {
      const state = listRef.current.getState();
      await listRef.current.scrollToOffset({
        animated: false,
        offset: Math.max(0, state.scroll - 240),
      });
      await settleLayout();
      return snapshot();
    },
    snapshot,
  };

  return (
    <View style={{ height: VIEWPORT_HEIGHT, width: 420 }}>
      <LegendList
        {...diagnosticHandlers}
        alignItemsAtEnd
        {...(anchor === null
          ? {}
          : {
              anchoredEndSpace: anchorSpace,
              ...(initialUnread ? { initialScrollIndex: anchorIndex } : {}),
            })}
        data={rows}
        drawDistance={250}
        estimatedItemSize={80}
        extraData={String(completed) + ":" + String(agentHeight) + ":" + String(lateSliceGrowth)}
        initialScrollAtEnd={anchor === null}
        keyExtractor={(item) => item.id}
        maintainScrollAtEnd={{
          animated: false,
          on: { dataChange: true, footerLayout: true, itemLayout: true, layout: true },
        }}
        maintainScrollAtEndThreshold={0.02}
        maintainVisibleContentPosition={{ data: true, size: true }}
        recycleItems={false}
        ref={listRef}
        renderScrollComponent={ProbeScrollView}
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: item.kind.includes("agent") ? "#292f3a" : "#17191d",
              borderBottomColor: "#444",
              borderBottomWidth: 1,
              height:
                item.kind === "streaming-agent"
                  ? agentHeight
                  : item.id === AGENT_KEY + "-slice-10"
                    ? item.height + lateSliceGrowth
                    : item.height,
            }}
            testID={item.id === AGENT_KEY ? "agent-response" : item.id}
          >
            <Text style={{ color: "white" }}>{item.id}</Text>
          </View>
        )}
      />
    </View>
  );
}

createRoot(document.getElementById("root")).render(<Probe />);
`,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      sourcefile: "legend-list-response-positioning-probe.tsx",
    },
    alias: {
      "@legendapp/list/react-native": legendListNativeEntry,
      "react-native": "react-native-web",
    },
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      global: "globalThis",
    },
    format: "iife",
    logLevel: "silent",
    platform: "browser",
    write: false,
  });
  probeScript = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function openProbe({ initialUnread = false, singleLongRow = false } = {}) {
  const page = await browser.newPage({ viewport: { height: 720, width: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate(
    (options) => {
      window.initialUnread = options.initialUnread;
      window.singleLongRow = options.singleLongRow;
    },
    { initialUnread, singleLongRow },
  );
  await page.addScriptTag({ content: probeScript });
  await page.waitForFunction(() => window.probe !== undefined);
  return { errors, page };
}

test("an unread response opens at its first physical row", async () => {
  const { errors, page } = await openProbe({ initialUnread: true });
  try {
    await expect
      .poll(() => page.evaluate(() => window.probe.snapshot().agent?.top))
      .toBeGreaterThanOrEqual(-1);
    const snapshot = await page.evaluate(() => window.probe.snapshot());
    assert.ok((snapshot.agent?.top ?? 100) <= 96, JSON.stringify(snapshot));
    assert.equal(snapshot.physicalAtEnd, false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("the production recorder captures a competing anchor after a real LegendList end scroll", async () => {
  const { errors, page } = await openProbe({ initialUnread: true });
  try {
    await expect
      .poll(() => page.evaluate(() => window.probe.snapshot().agent?.top))
      .toBeGreaterThanOrEqual(-1);
    await page.evaluate(() => window.probe.diagnosticJumpToEnd());
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);
    await page.evaluate(() => window.probe.replayAnchor());
    await expect
      .poll(() => page.evaluate(() => window.probe.diagnosticReport().lastRebound.length))
      .toBeGreaterThan(0);
    const report = await page.evaluate(() => window.probe.diagnosticReport());
    const rebound = report.lastRebound.at(-1);
    assert.equal(rebound.name, "chat.scroll.rebound");
    assert.equal(rebound.tags.source, "response-start");
    assert.ok(rebound.values.fromOffsetY > rebound.values.offsetY + 360);
    assert.ok(
      report.lastRebound.some(
        (event) => event.name === "chat.scroll.command" && event.tags.source === "jump-end",
      ),
    );
    assert.ok(
      report.lastRebound.some(
        (event) => event.name === "chat.scroll.command" && event.tags.source === "response-start",
      ),
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("stream growth follows the tail and completion reveals the response start", async () => {
  const { errors, page } = await openProbe();
  try {
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);
    const streaming = await page.evaluate(() => window.probe.growStream());
    assert.equal(streaming.atEnd, true, JSON.stringify(streaming));
    await page.evaluate(() => window.probe.complete());
    await expect
      .poll(() => page.evaluate(() => window.probe.snapshot().agent?.top))
      .toBeGreaterThanOrEqual(-1);
    const completed = await page.evaluate(() => window.probe.snapshot());
    assert.ok((completed.agent?.top ?? 100) <= 96, JSON.stringify(completed));
    assert.equal(completed.physicalAtEnd, false);
    const afterLateLayout = await page.evaluate(() => window.probe.growLateCompletedSlice());
    assert.ok((afterLateLayout.agent?.top ?? 100) <= 96, JSON.stringify(afterLateLayout));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("completion does not steal position after a manual scroll away", async () => {
  const { errors, page } = await openProbe();
  try {
    await page.evaluate(() => window.probe.growStream());
    const away = await page.evaluate(() => window.probe.scrollAway());
    assert.equal(away.atEnd, false, JSON.stringify(away));
    const completed = await page.evaluate(() => window.probe.complete());
    assert.equal(completed.atEnd, false, JSON.stringify(completed));
    assert.ok(Math.abs(completed.scroll - away.scroll) < 2, JSON.stringify({ away, completed }));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("one long final row anchors once, then permits manual scrolling and the end button", async () => {
  const { errors, page } = await openProbe({ singleLongRow: true });
  try {
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);
    await page.evaluate(() => window.probe.complete());
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().agent?.top)).toBe(64);
    await page.evaluate(() => window.probe.diagnosticJumpToEnd());
    await page.evaluate(() => window.probe.repeatReady());
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);
    const report = await page.evaluate(() => window.probe.diagnosticReport());
    assert.equal(
      report.samples.filter(
        (event) =>
          event.name === "chat.scroll.command" &&
          event.tags.source === "response-start" &&
          event.tags.phase === "issued",
      ).length,
      1,
    );
    await page.evaluate(() => window.probe.scrollAway());
    await page.evaluate(() => window.probe.manualEnd());
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
