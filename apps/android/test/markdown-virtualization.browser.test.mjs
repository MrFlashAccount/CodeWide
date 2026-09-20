import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
const androidRoot = fileURLToPath(new URL("../", import.meta.url));
const legendListNativeEntry = fileURLToPath(
  new URL("../node_modules/@legendapp/list/react-native.js", import.meta.url),
);
const artifactDirectory = fileURLToPath(
  new URL("../../../test-results/markdown-virtualization/", import.meta.url),
);

let browser;
let experimentScript;

before(async () => {
  const result = await build({
    absWorkingDir: androidRoot,
    alias: {
      "@legendapp/list/react-native": legendListNativeEntry,
      "expo-font": "./experiments/markdown-virtualization/expo-font-web-stub.ts",
      "expo-modules-core": "./experiments/markdown-virtualization/expo-modules-core-web-stub.ts",
      "react-native": "react-native-web",
    },
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      global: "globalThis",
    },
    entryPoints: ["experiments/markdown-virtualization/experiment.tsx"],
    format: "iife",
    logLevel: "silent",
    platform: "browser",
    write: false,
  });
  experimentScript = result.outputFiles[0].text;
  await mkdir(artifactDirectory, { recursive: true });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function openExperiment(mode) {
  const page = await browser.newPage({ viewport: { height: 920, width: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<!doctype html><html><head><style>
    html, body, #root { height: 100%; margin: 0; overflow: hidden; width: 100%; }
    body { background: #0b0d11; font-family: Inter, system-ui, sans-serif; }
    * { box-sizing: border-box; }
  </style></head><body><div id="root"></div></body></html>`);
  await page.evaluate((selectedMode) => {
    window.__MARKDOWN_EXPERIMENT_MODE__ = selectedMode;
    window.__MARKDOWN_EXPERIMENT_START__ = performance.now();
  }, mode);
  await page.addScriptTag({ content: experimentScript });
  await page.waitForFunction(() => window.markdownVirtualizationExperiment !== undefined);
  await page.waitForFunction(() => {
    const metrics = window.markdownVirtualizationExperiment?.snapshot();
    return (
      metrics !== undefined &&
      metrics.initialContentPaintMs >= 0 &&
      metrics.legendLoadMs >= 0 &&
      metrics.mountedBlocks > 0
    );
  });
  const metrics = await page.evaluate(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return window.markdownVirtualizationExperiment.snapshot();
  });
  return { errors, metrics, page };
}

async function benchmark(mode, runs) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const opened = await openExperiment(mode);
    try {
      assert.deepEqual(opened.errors, []);
      samples.push(opened.metrics);
    } finally {
      await opened.page.close();
    }
  }
  samples.sort((left, right) => left.initialContentPaintMs - right.initialContentPaintMs);
  return { median: samples[Math.floor(samples.length / 2)], samples };
}

function medianByPaint(samples) {
  const ordered = [...samples].sort((left, right) => left.paintMs - right.paintMs);
  return ordered[Math.floor(ordered.length / 2)];
}

async function benchmarkScroll(mode, runs) {
  const samples = [];
  for (let run = 0; run < runs; run += 1) {
    const opened = await openExperiment(mode);
    try {
      assert.deepEqual(opened.errors, []);
      const oneViewportUp = await opened.page.evaluate(() =>
        window.markdownVirtualizationExperiment.scrollOneViewportUp(),
      );
      const toStart = await opened.page.evaluate(() =>
        window.markdownVirtualizationExperiment.scrollToStart(),
      );
      const toEnd = await opened.page.evaluate(() =>
        window.markdownVirtualizationExperiment.scrollToEnd(),
      );
      samples.push({ oneViewportUp, toEnd, toStart });
    } finally {
      await opened.page.close();
    }
  }
  return {
    median: {
      oneViewportUp: medianByPaint(samples.map((sample) => sample.oneViewportUp)),
      toEnd: medianByPaint(samples.map((sample) => sample.toEnd)),
      toStart: medianByPaint(samples.map((sample) => sample.toStart)),
    },
    samples,
  };
}

test("real Legend List bounds Markdown mounting and keeps historical tools in a sheet", async () => {
  const baseline = await benchmark("baseline", 3);
  const virtualized = await benchmark("virtualized", 3);
  const premeasured = await benchmark("virtualized-premeasured", 3);
  const virtualizedScroll = await benchmarkScroll("virtualized", 3);
  const premeasuredScroll = await benchmarkScroll("virtualized-premeasured", 3);
  assert.ok(baseline.median.contentChars >= 72_000, JSON.stringify(baseline.median));
  assert.equal(virtualized.median.contentChars, baseline.median.contentChars);
  assert.equal(virtualized.median.totalBlocks, baseline.median.totalBlocks);
  assert.equal(premeasured.median.contentChars, baseline.median.contentChars);
  assert.equal(premeasured.median.totalBlocks, baseline.median.totalBlocks);
  assert.ok(premeasured.median.premeasureMs > 0);
  assert.ok(baseline.median.initialContentPaintMs > 0);
  assert.ok(virtualized.median.initialContentPaintMs > 0);
  assert.ok(premeasured.median.initialContentPaintMs > 0);
  assert.equal(premeasured.median.sizeChangeCount, 0, JSON.stringify(premeasured.median));
  assert.ok(virtualized.median.sizeChangeCount > 0, JSON.stringify(virtualized.median));
  assert.equal(baseline.median.peakMountedBlocks, baseline.median.totalBlocks);
  assert.ok(
    virtualized.median.peakMountedBlocks < Math.max(60, virtualized.median.totalBlocks * 0.08),
    JSON.stringify(virtualized.median),
  );
  assert.ok(
    virtualized.median.profilerActualMs <= baseline.median.profilerActualMs * 0.5,
    JSON.stringify({ baseline: baseline.median, virtualized: virtualized.median }),
  );
  assert.ok(
    virtualized.median.domNodes < baseline.median.domNodes * 0.25,
    JSON.stringify({ baseline: baseline.median, virtualized: virtualized.median }),
  );
  for (const result of [virtualizedScroll.median, premeasuredScroll.median]) {
    assert.ok(result.oneViewportUp.paintMs > 0, JSON.stringify(result));
    assert.ok(result.oneViewportUp.renderCalls > 0, JSON.stringify(result));
    assert.notEqual(
      result.oneViewportUp.fromVisibleStart,
      result.oneViewportUp.toVisibleStart,
      JSON.stringify(result),
    );
    assert.ok(result.toStart.renderCalls > 0, JSON.stringify(result));
    assert.equal(result.toStart.toVisibleStart, 0, JSON.stringify(result));
    assert.ok(result.toEnd.renderCalls > 0, JSON.stringify(result));
    assert.equal(
      result.toEnd.toVisibleEnd,
      baseline.median.totalBlocks - 1,
      JSON.stringify(result),
    );
  }

  const baselineShot = await openExperiment("baseline");
  const virtualizedShot = await openExperiment("virtualized");
  const premeasuredShot = await openExperiment("virtualized-premeasured");
  let premeasuredGeometry;
  try {
    await baselineShot.page.evaluate(() => window.markdownVirtualizationExperiment.scrollToEnd());
    await settleListAtPhysicalEnd(virtualizedShot.page);
    await settleListAtPhysicalEnd(premeasuredShot.page);
    await baselineShot.page.screenshot({
      path: `${artifactDirectory}/baseline.png`,
    });
    await virtualizedShot.page.screenshot({
      path: `${artifactDirectory}/virtualized.png`,
    });
    await premeasuredShot.page.screenshot({
      path: `${artifactDirectory}/virtualized-premeasured.png`,
    });

    const visibleSegments = await virtualizedShot.page.locator("[data-block-index]").count();
    assert.ok(visibleSegments > 0);
    assert.ok(visibleSegments < virtualized.median.totalBlocks);
    const segmentBounds = await virtualizedShot.page
      .locator("[data-block-index]")
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const bounds = element.getBoundingClientRect();
            return {
              bottom: bounds.bottom,
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
            };
          })
          .sort((left, right) => left.top - right.top),
      );
    assert.ok(segmentBounds.every((bounds) => Math.abs(bounds.width - 620) <= 0.5));
    assert.ok(
      segmentBounds.every((bounds) => Math.abs(bounds.left - segmentBounds[0].left) <= 0.5),
    );
    for (let index = 1; index < segmentBounds.length; index += 1) {
      assert.ok(Math.abs(segmentBounds[index].top - segmentBounds[index - 1].bottom) <= 0.5);
    }
    const baselineSurface = await baselineShot.page
      .locator('[data-testid="baseline-bubble"]')
      .evaluate(surfaceStyle);
    const lastSurface = await virtualizedShot.page
      .locator(`[data-block-index="${String(baseline.median.totalBlocks - 1)}"]`)
      .evaluate(surfaceStyle);
    assert.equal(lastSurface.backgroundColor, baselineSurface.backgroundColor);
    assert.equal(lastSurface.borderBottomLeftRadius, baselineSurface.borderBottomLeftRadius);
    assert.equal(lastSurface.borderBottomRightRadius, baselineSurface.borderBottomRightRadius);
    assert.equal(lastSurface.paddingBottom, baselineSurface.paddingBottom);
    assert.equal(lastSurface.paddingLeft, baselineSurface.paddingLeft);
    assert.equal(lastSurface.paddingRight, baselineSurface.paddingRight);
    assert.equal(lastSurface.width, baselineSurface.width);
    await virtualizedShot.page.evaluate(() =>
      window.markdownVirtualizationExperiment.scrollToStart(),
    );
    const firstSurface = await virtualizedShot.page
      .locator('[data-block-index="0"]')
      .evaluate(surfaceStyle);
    assert.equal(firstSurface.backgroundColor, baselineSurface.backgroundColor);
    assert.equal(firstSurface.borderTopLeftRadius, baselineSurface.borderTopLeftRadius);
    assert.equal(firstSurface.borderTopRightRadius, baselineSurface.borderTopRightRadius);
    assert.equal(firstSurface.paddingLeft, baselineSurface.paddingLeft);
    assert.equal(firstSurface.paddingRight, baselineSurface.paddingRight);
    assert.equal(firstSurface.paddingTop, baselineSurface.paddingTop);
    assert.equal(firstSurface.width, baselineSurface.width);
    premeasuredGeometry = await premeasuredShot.page
      .locator("[data-block-index]")
      .evaluateAll((elements) => {
        const blocks = elements.map((element) => {
          const blockIndex = element.getAttribute("data-block-index");
          const content = element.querySelector(
            `[data-testid="markdown-block-content-${blockIndex}"]`,
          );
          const bounds = element.getBoundingClientRect();
          const contentBounds = content?.getBoundingClientRect();
          const style = getComputedStyle(element);
          const contentCapacity =
            bounds.height -
            Number.parseFloat(style.paddingTop) -
            Number.parseFloat(style.paddingBottom);
          const contentHeight = contentBounds?.height ?? 0;
          return {
            contentError: contentHeight - contentCapacity,
            fixedHeight: Number(element.getAttribute("data-fixed-height")),
            height: bounds.height,
            index: Number(blockIndex),
          };
        });
        return {
          blocks,
          maxAbsoluteError: Math.max(...blocks.map((block) => Math.abs(block.contentError))),
          maxOverflow: Math.max(...blocks.map((block) => block.contentError)),
        };
      });
    assert.ok(premeasuredGeometry.maxAbsoluteError <= 1, JSON.stringify(premeasuredGeometry));

    await virtualizedShot.page.evaluate(() => window.markdownVirtualizationExperiment.openTools());
    assert.equal(await virtualizedShot.page.locator('[data-testid="tools-sheet"]').count(), 1);
    const mountedToolRows = await virtualizedShot.page
      .locator('[data-testid^="tool-row-"]')
      .count();
    assert.ok(mountedToolRows > 0);
    assert.ok(mountedToolRows < 40);
    await virtualizedShot.page.screenshot({
      path: `${artifactDirectory}/tools-sheet.png`,
    });
    assert.deepEqual(baselineShot.errors, []);
    assert.deepEqual(virtualizedShot.errors, []);
    assert.deepEqual(premeasuredShot.errors, []);
  } finally {
    await baselineShot.page.close();
    await virtualizedShot.page.close();
    await premeasuredShot.page.close();
  }

  const report = {
    baseline,
    premeasured,
    premeasuredGeometry,
    premeasuredScroll,
    virtualized,
    virtualizedScroll,
  };
  await writeFile(`${artifactDirectory}/metrics.json`, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nmarkdown virtualization benchmark\n${JSON.stringify(report, null, 2)}\n`);
});

function surfaceStyle(element) {
  const style = getComputedStyle(element);
  return {
    backgroundColor: style.backgroundColor,
    borderBottomLeftRadius: style.borderBottomLeftRadius,
    borderBottomRightRadius: style.borderBottomRightRadius,
    borderTopLeftRadius: style.borderTopLeftRadius,
    borderTopRightRadius: style.borderTopRightRadius,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    paddingTop: style.paddingTop,
    width: style.width,
  };
}

async function settleListAtPhysicalEnd(page) {
  await page.locator('[data-testid="markdown-list"]').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}
