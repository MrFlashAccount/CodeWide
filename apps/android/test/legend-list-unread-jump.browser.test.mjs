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
import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";

const VIEWPORT_HEIGHT = 360;
const UNREAD_KEY = "turn-80";
const initialRows = Array.from({ length: 40 }, (_, index) => ({
  height: 80,
  id: "turn-" + String(index + 20),
}));
const latestRows = Array.from({ length: 40 }, (_, index) => {
  const turn = index + 60;
  return {
    height: turn === 80 ? 1000 : 80,
    id: "turn-" + String(turn),
    unread: turn === 80,
  };
});

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settleLayout() {
  await nextFrame();
  await nextFrame();
}

function ProbeScrollView(props) {
  return <ScrollView {...props} testID="probe-scroll" />;
}

function Probe() {
  const listRef = useRef(null);
  const pendingJumpRef = useRef(null);
  const [footerHeight, setFooterHeight] = useState(40);
  const [jumpRevision, setJumpRevision] = useState(0);
  const [rows, setRows] = useState(initialRows);
  const [tailHeight, setTailHeight] = useState(80);

  function unreadGeometry() {
    const marker = document.querySelector('[data-testid="unread-message"]');
    const viewport = document.querySelector('[data-testid="probe-scroll"]');
    if (marker === null || viewport === null) {
      return null;
    }
    const markerBounds = marker.getBoundingClientRect();
    const viewportBounds = viewport.getBoundingClientRect();
    return {
      bottom: markerBounds.bottom - viewportBounds.top,
      top: markerBounds.top - viewportBounds.top,
      visible:
        markerBounds.bottom > viewportBounds.top && markerBounds.top < viewportBounds.bottom,
    };
  }

  async function executePendingJump() {
    const pending = pendingJumpRef.current;
    const list = listRef.current;
    if (pending === null || list === null) {
      return;
    }
    pendingJumpRef.current = null;
    await settleLayout();
    const state = list.getState();
    const unreadIndex = state.indexByKey(UNREAD_KEY);
    const geometry = unreadGeometry();
    const unreadOffset =
      unreadIndex === undefined ? null : state.positionAtIndex(unreadIndex) - state.scroll;
    const unreadIsBelow =
      geometry === null ? unreadOffset === null || unreadOffset >= 0 : !geometry.visible && geometry.bottom > 0;
    if (unreadIndex !== undefined && unreadIsBelow) {
      let attempts = 0;
      while (attempts < 3 && unreadGeometry()?.visible !== true) {
        attempts += 1;
        await list.scrollToIndex({ animated: false, index: unreadIndex, viewPosition: 1 });
        await settleLayout();
      }
      pending.resolve({ action: "unread", attempts, snapshot: window.probe.snapshot() });
      return;
    }
    await list.scrollToEnd({ animated: false });
    await settleLayout();
    pending.resolve({ action: "end", attempts: 1, snapshot: window.probe.snapshot() });
  }

  useLayoutEffect(() => {
    void executePendingJump();
  }, [jumpRevision, rows]);

  window.probe = {
    async expandTail() {
      setTailHeight((value) => value + 340);
      await settleLayout();
      setFooterHeight((value) => value + 200);
      await settleLayout();
      await settleLayout();
      return window.probe.snapshot();
    },
    async expandFooter() {
      setFooterHeight((value) => value + 200);
      await settleLayout();
      await settleLayout();
      return window.probe.snapshot();
    },
    async jump() {
      return new Promise((resolve) => {
        pendingJumpRef.current = { resolve };
        setRows(latestRows);
        setJumpRevision((value) => value + 1);
      });
    },
    async loadLatestAtUnreadStart() {
      setRows(latestRows);
      await settleLayout();
      await settleLayout();
      const index = listRef.current.getState().indexByKey(UNREAD_KEY);
      await listRef.current.scrollToIndex({ animated: false, index, viewPosition: 0 });
      await settleLayout();
      return window.probe.snapshot();
    },
    async scrollAwayFromTail() {
      const state = listRef.current.getState();
      await listRef.current.scrollToOffset({
        animated: false,
        offset: Math.max(0, state.contentLength - state.scrollLength - 600),
      });
      await settleLayout();
      return window.probe.snapshot();
    },
    async scrollBelowUnread() {
      setRows(latestRows);
      await settleLayout();
      await settleLayout();
      const state = listRef.current.getState();
      const unreadIndex = state.indexByKey(UNREAD_KEY);
      await listRef.current.scrollToOffset({
        animated: false,
        offset: state.positionAtIndex(unreadIndex) + 1120,
      });
      await settleLayout();
      return window.probe.snapshot();
    },
    snapshot() {
      const state = listRef.current?.getState();
      const unreadIndex = state?.indexByKey(UNREAD_KEY);
      const scroller = document.querySelector('[data-testid="probe-scroll"]');
      const physicalDistanceFromEnd =
        scroller === null ? -1 : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      return {
        atEnd: state?.isAtEnd ?? false,
        end: state?.end ?? -1,
        endBuffered: state?.endBuffered ?? -1,
        marker: unreadGeometry(),
        physicalAtEnd: physicalDistanceFromEnd >= 0 && physicalDistanceFromEnd <= 1,
        physicalDistanceFromEnd,
        scroll: state?.scroll ?? 0,
        scrollLength: state?.scrollLength ?? 0,
        start: state?.start ?? -1,
        startBuffered: state?.startBuffered ?? -1,
        unreadIndex: unreadIndex ?? -1,
        unreadOffset:
          unreadIndex === undefined ? null : state.positionAtIndex(unreadIndex) - state.scroll,
      };
    },
  };

  return (
    <View style={{ height: VIEWPORT_HEIGHT, width: 420 }}>
      <LegendList
        alignItemsAtEnd
        data={rows}
        drawDistance={250}
        estimatedItemSize={80}
        keyExtractor={(item) => item.id}
        ListFooterComponent={<View style={{ height: footerHeight }} testID="probe-footer" />}
        maintainScrollAtEnd={{
          animated: false,
          on:
            window.enableCompleteLayoutFollow === false
              ? { dataChange: true, itemLayout: true }
              : { dataChange: true, footerLayout: true, itemLayout: true, layout: true },
        }}
        maintainScrollAtEndThreshold={0.02}
        maintainVisibleContentPosition={{ data: true, size: true }}
        recycleItems={false}
        ref={listRef}
        renderScrollComponent={ProbeScrollView}
        renderItem={({ item }) => {
          const height = item.id === "turn-99" ? tailHeight : item.height;
          return (
            <View
              style={{
                backgroundColor: item.unread ? "#292f3a" : "#17191d",
                borderBottomColor: "#444",
                borderBottomWidth: 1,
                height,
                justifyContent: "flex-end",
              }}
              testID={"row-" + item.id}
            >
              <Text style={{ color: "white" }}>{item.id}</Text>
              {item.unread ? (
                <View style={{ backgroundColor: "#7357ff", height: 120 }} testID="unread-message">
                  <Text style={{ color: "white" }}>Unread agent message</Text>
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

createRoot(document.getElementById("root")).render(<Probe />);
`,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      sourcefile: "legend-list-unread-jump-probe.tsx",
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

async function openProbe({ completeLayoutFollow = true } = {}) {
  const page = await browser.newPage({ viewport: { height: 720, width: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.evaluate((enabled) => {
    window.enableCompleteLayoutFollow = enabled;
  }, completeLayoutFollow);
  await page.addScriptTag({ content: probeScript });
  await page.waitForFunction(() => window.probe !== undefined);
  return { errors, page };
}

test("a visible turn row does not prove that its nested unread message is visible", async () => {
  const { errors, page } = await openProbe();
  try {
    const snapshot = await page.evaluate(() => window.probe.loadLatestAtUnreadStart());
    assert.ok(snapshot.unreadIndex >= snapshot.start && snapshot.unreadIndex <= snapshot.end);
    assert.equal(snapshot.marker?.visible, false);

    const jump = await page.evaluate(() => window.probe.jump());
    assert.equal(jump.action, "unread");
    assert.equal(jump.snapshot.marker?.visible, true);
    assert.equal(jump.snapshot.atEnd, false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("two presses move from a paged window to unread and then to the absolute tail", async () => {
  const { errors, page } = await openProbe();
  try {
    const first = await page.evaluate(() => window.probe.jump());
    assert.equal(first.action, "unread");
    assert.equal(first.attempts, 2);
    assert.equal(first.snapshot.marker?.visible, true, JSON.stringify(first.snapshot));
    assert.equal(first.snapshot.atEnd, false);

    const second = await page.evaluate(() => window.probe.jump());
    assert.equal(second.action, "end");
    assert.equal(second.snapshot.atEnd, true);
    assert.equal(second.snapshot.physicalAtEnd, true, JSON.stringify(second.snapshot));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("a viewport already below unread continues to the absolute tail", async () => {
  const { errors, page } = await openProbe();
  try {
    const below = await page.evaluate(() => window.probe.scrollBelowUnread());
    assert.ok((below.unreadOffset ?? 0) < 0, JSON.stringify(below));
    assert.equal(below.physicalAtEnd, false);

    const jump = await page.evaluate(() => window.probe.jump());
    assert.equal(jump.action, "end");
    assert.equal(jump.snapshot.physicalAtEnd, true, JSON.stringify(jump.snapshot));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("the real list keeps the absolute tail through late row and footer growth", async () => {
  const { errors, page } = await openProbe();
  try {
    await page.evaluate(() => window.probe.jump());
    const tail = await page.evaluate(() => window.probe.jump());
    assert.equal(tail.snapshot.atEnd, true, JSON.stringify(tail.snapshot));
    assert.equal(tail.snapshot.physicalAtEnd, true, JSON.stringify(tail.snapshot));

    await page.evaluate(() => window.probe.expandTail());
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().atEnd)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.probe.snapshot().physicalAtEnd)).toBe(true);

    const away = await page.evaluate(() => window.probe.scrollAwayFromTail());
    assert.equal(away.atEnd, false);
    const scrollBeforeGrowth = away.scroll;
    await page.evaluate(() => window.probe.expandTail());
    const afterGrowth = await page.evaluate(() => window.probe.snapshot());
    assert.equal(afterGrowth.atEnd, false, JSON.stringify({ afterGrowth, scrollBeforeGrowth }));
    assert.equal(afterGrowth.physicalAtEnd, false);
    assert.ok(Math.abs(afterGrowth.scroll - scrollBeforeGrowth) < 2);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("the current item-only config leaves a physical footer gap behind a stale at-end flag", async () => {
  const { errors, page } = await openProbe({ completeLayoutFollow: false });
  try {
    await page.evaluate(() => window.probe.jump());
    const tail = await page.evaluate(() => window.probe.jump());
    assert.equal(tail.snapshot.atEnd, true);

    const scrollBeforeGrowth = tail.snapshot.scroll;
    const afterGrowth = await page.evaluate(() => window.probe.expandFooter());
    assert.equal(afterGrowth.atEnd, true, JSON.stringify({ afterGrowth, scrollBeforeGrowth }));
    assert.equal(afterGrowth.physicalAtEnd, false, JSON.stringify(afterGrowth));
    assert.ok(afterGrowth.physicalDistanceFromEnd > 190);
    assert.ok(Math.abs(afterGrowth.scroll - scrollBeforeGrowth) < 2);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});
