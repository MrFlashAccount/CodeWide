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
  const listRef = useRef(null);
  const [agentHeight, setAgentHeight] = useState(initialUnread ? 1200 : 120);
  const [anchor, setAnchor] = useState(initialUnread ? AGENT_KEY : null);
  const [completed, setCompleted] = useState(initialUnread);
  const [lateSliceGrowth, setLateSliceGrowth] = useState(0);
  const rows = completed ? completedRows : streamingRows;
  const anchorIndex = rows.findIndex((row) => row.id === anchor);

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

  async function applyAnchor(info) {
    if (anchor === null || info.anchorKey !== anchor || info.anchorIndex !== anchorIndex) {
      return;
    }
    await listRef.current.scrollToIndex({
      animated: false,
      index: anchorIndex,
      viewOffset: RESPONSE_START_OFFSET,
      viewPosition: 0,
    });
    await settleLayout();
  }

  window.probe = {
    async complete() {
      const shouldAnchor = listRef.current.getState().isWithinMaintainScrollAtEndThreshold;
      setCompleted(true);
      if (shouldAnchor) {
        setAnchor(AGENT_KEY);
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
        alignItemsAtEnd
        {...(anchor === null
          ? {}
          : {
              anchoredEndSpace: {
                anchorIndex,
                anchorOffset: RESPONSE_START_OFFSET,
                onReady: applyAnchor,
              },
              initialScrollIndex: anchorIndex,
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

async function openProbe({ initialUnread = false } = {}) {
  const page = await browser.newPage({ viewport: { height: 720, width: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate((unread) => {
    window.initialUnread = unread;
  }, initialUnread);
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
