import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
let browser;
const scripts = new Map();

async function buildProbe(extension) {
  const nativeEntry = fileURLToPath(
    new URL(`../node_modules/@legendapp/list/react-native.${extension}`, import.meta.url),
  );
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    stdin: {
      contents: `
import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrollView, Text, View } from "react-native";
import { LegendList } from "@legendapp/list/react-native";

const rows = Array.from({ length: 40 }, (_, index) => ({ id: String(index) }));
const bridge = { currentOffset: null, resets: 0, commits: [], commands: [], performance: [], sizeHintCalls: {} };

function getItemSizeHint(item) {
  bridge.sizeHintCalls[item.id] = (bridge.sizeHintCalls[item.id] ?? 0) + 1;
  const even = Number(item.id) % 2 === 0;
  return { size: even ? 60 : 180, status: even ? "exact" : "estimated" };
}

// Model only the Android ReactScrollView.setContentOffset contract. The real native
// LegendList supplies the props; DOM layout supplies physical scroll measurements.
// On Android, null is a reset command, including repeated null -> null commits.
function NativeOffsetScrollView({ contentOffset, ref, ...props }) {
  const scrollRef = useRef(null);
  const previousOffset = useRef(null);
  useLayoutEffect(() => {
    const next = contentOffset?.y ?? null;
    bridge.commits.push(next);
    if (previousOffset.current === null || previousOffset.current !== next) {
      previousOffset.current = next;
      bridge.currentOffset = next;
      if (next === null) bridge.resets += 1;
      scrollRef.current?.scrollTo({ animated: false, y: next ?? 0 });
    }
  });
  return <ScrollView {...props} testID="native-offset-probe" ref={value => {
    scrollRef.current = value;
    if (typeof ref === "function") ref(value);
    else if (ref) ref.current = value;
  }} />;
}

function Probe() {
  const list = useRef(null);
  const [positioned, setPositioned] = useState(false);
  const [revision, setRevision] = useState(0);
  const [conversation, setConversation] = useState(0);
  const [data, setData] = useState(window.probeOptions.empty ? [] : rows);
  const unread = window.probeOptions.unread || conversation > 0;
  window.probe = {
    hydrate: () => setData(rows),
    newConversation: () => {
      setPositioned(false);
      setConversation(value => value + 1);
    },
    releaseBootstrap: () => setPositioned(true),
    rerender: () => setRevision(value => value + 1),
    jump: () => list.current.scrollToEnd({ animated: false }),
    scrollAway: () => list.current.scrollToOffset({ animated: false, offset: 900 }),
    snapshot: () => {
      const scroller = document.querySelector('[data-testid="native-offset-probe"]');
      return {
        commits: bridge.commits,
        commands: bridge.commands,
        performance: bridge.performance,
        sizeHintCalls: bridge.sizeHintCalls,
        currentOffset: bridge.currentOffset,
        resets: bridge.resets,
        scroll: scroller?.scrollTop ?? 0,
        viewportHeight: scroller?.clientHeight ?? 0,
        contentHeight: scroller?.scrollHeight ?? 0,
        logicalViewportHeight: list.current?.getState().scrollLength ?? 0,
        row20Position: list.current?.getState().positionByKey("20") ?? null,
        distance: scroller ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop : -1,
        ready: list.current?.getState().scrollLength > 0,
      };
    },
  };
  return <View style={{ height: 360, width: 420 }}>
    <LegendList
      data={data}
      estimatedItemSize={100}
      getItemSizeHint={window.probeOptions.perItemEstimate ? getItemSizeHint : undefined}
      estimatedListSize={{ height: 360, width: 420 }}
      extraData={revision}
      initialScrollAtEnd={!positioned && !unread}
      onScrollDiagnostic={window.probeOptions.observe === false ? undefined : event => {
        if (window.probeOptions.throwObserver) throw new Error("Diagnostic failure");
        if (event.phase === "calculate" || event.phase === "size-batch") {
          bridge.performance.push(event);
          return;
        }
        const observedOffset = document.querySelector('[data-testid="native-offset-probe"]')?.scrollTop ?? 0;
        bridge.commands.push({ ...event, observedOffset });
      }}
      {...(!positioned && unread ? { initialScrollIndex: conversation > 0 ? 8 : 30 } : {})}
      key={conversation}
      keyExtractor={item => item.id}
      recycleItems={false}
      ref={list}
      renderScrollComponent={NativeOffsetScrollView}
      renderItem={({ item }) => <View style={{ height: 100 }}><Text>{item.id}</Text></View>}
    />
  </View>;
}
createRoot(document.getElementById("root")).render(<Probe />);
`,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    alias: { "@legendapp/list/react-native": nativeEntry },
    plugins: [
      {
        name: "android-platform-with-dom-layout",
        setup(builder) {
          builder.onResolve({ filter: /^react-native$/ }, () => ({
            path: "native",
            namespace: "probe",
          }));
          builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
            contents: `export * from "react-native-web";
import { Platform as WebPlatform } from "react-native-web";
export const Platform = { ...WebPlatform, OS: "android", select: values => values.android ?? values.native ?? values.default };`,
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
  for (const extension of ["js", "mjs"]) {
    scripts.set(extension, await buildProbe(extension));
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

for (const extension of ["js", "mjs"]) {
  test(`${extension}: one per-item hint resolves exact and estimated row positions`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="root"></div>');
      await page.evaluate(() => {
        window.probeOptions = { perItemEstimate: true, unread: true };
        window.nativeFabricUIManager = {};
      });
      await page.addScriptTag({ content: scripts.get(extension) });
      await expect.poll(() => page.evaluate(() => window.probe?.snapshot().ready)).toBe(true);
      await expect
        .poll(() => page.evaluate(() => window.probe.snapshot().row20Position))
        .toBeGreaterThan(2100);
      const sizeHintCalls = await page.evaluate(() => window.probe.snapshot().sizeHintCalls);
      assert.ok(Object.keys(sizeHintCalls).length > 0);
      assert.equal(Math.max(...Object.values(sizeHintCalls)), 1);
    } finally {
      await page.close();
    }
  });

  for (const mode of ["record", "absent", "throw"]) {
    test(`${extension}: internal dispatch diagnostics are observational with ${mode} observer`, async () => {
      const page = await browser.newPage();
      try {
        await page.setContent('<div id="root"></div>');
        await page.evaluate((mode) => {
          window.probeOptions = { observe: mode !== "absent", throwObserver: mode === "throw" };
          window.nativeFabricUIManager = {};
        }, mode);
        await page.addScriptTag({ content: scripts.get(extension) });
        await expect.poll(() => page.evaluate(() => window.probe?.snapshot().ready)).toBe(true);
        await expect
          .poll(() => page.evaluate(() => window.probe.snapshot().scroll))
          .toBeGreaterThan(900);
        await expect
          .poll(() => page.evaluate(() => window.probe?.snapshot().distance))
          .toBeLessThanOrEqual(1);
        await page.evaluate(() => window.probe.scrollAway());
        await expect.poll(() => page.evaluate(() => window.probe.snapshot().scroll)).toBe(900);
        const snapshot = await page.evaluate(() => window.probe.snapshot());
        if (mode === "record") {
          // The native mount seed can settle bootstrap without an imperative command.
          // An explicit request, however, must be observed before native movement.
          const away = snapshot.commands.find(
            (command) => !command.initial && command.offsetPx === 900,
          );
          assert.ok(away, JSON.stringify(snapshot.commands));
          assert.ok(away.observedOffset > 900, "observer must run before the native scroll");
          assert.equal(away.rowCount, 40);
          assert.equal(away.animated, false);
          assert.equal("data" in away, false);
          assert.ok(
            snapshot.performance.some((event) => event.phase === "calculate"),
            JSON.stringify(snapshot.performance),
          );
        } else {
          assert.deepEqual(snapshot.commands, []);
        }
      } finally {
        await page.close();
      }
    });
  }
  for (const empty of [false, true]) {
    for (const unread of [false, true]) {
      test(`${extension}: releasing ${unread ? "unread" : "tail"} bootstrap preserves scrolling after ${empty ? "delayed" : "cached"} data`, async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.setContent('<div id="root"></div>');
          await page.evaluate(
            (options) => {
              window.probeOptions = options;
              window.nativeFabricUIManager = {};
            },
            { empty, unread },
          );
          await page.addScriptTag({ content: scripts.get(extension) });
          await expect.poll(() => page.evaluate(() => window.probe?.snapshot().ready)).toBe(true);
          if (empty) {
            await page.evaluate(() => window.probe.hydrate());
          }
          await expect
            .poll(() => page.evaluate(() => window.probe.snapshot().scroll))
            .toBeGreaterThan(0);
          await page.evaluate(() => window.probe.jump());
          await expect
            .poll(() => page.evaluate(() => window.probe.snapshot().distance))
            .toBeLessThanOrEqual(1);
          const beforeRelease = await page.evaluate(() => window.probe.snapshot());
          await page.evaluate(() => window.probe.releaseBootstrap());
          await page.evaluate(() => new Promise(requestAnimationFrame));
          await page.evaluate(() => window.probe.rerender());
          await page.evaluate(() => new Promise(requestAnimationFrame));
          const afterRelease = await page.evaluate(() => window.probe.snapshot());
          assert.equal(
            afterRelease.resets,
            beforeRelease.resets,
            JSON.stringify({ beforeRelease, afterRelease }),
          );
          assert.ok(afterRelease.distance <= 1, JSON.stringify(afterRelease));
          await page.evaluate(() => window.probe.scrollAway());
          await page.evaluate(() => window.probe.rerender());
          await expect.poll(() => page.evaluate(() => window.probe.snapshot().scroll)).toBe(900);
          await page.evaluate(() => window.probe.newConversation());
          await expect.poll(() => page.evaluate(() => window.probe.snapshot().scroll)).toBe(800);
          assert.deepEqual(errors, []);
        } catch (error) {
          const snapshot = await page.evaluate(() => window.probe?.snapshot());
          throw new Error(JSON.stringify({ errors, snapshot }), { cause: error });
        } finally {
          await page.close();
        }
      });
    }
  }
}
