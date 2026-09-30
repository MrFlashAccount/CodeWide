import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
const androidRoot = fileURLToPath(new URL("../", import.meta.url));
const legendListNativeEntry = fileURLToPath(
  new URL("../node_modules/@legendapp/list/react-native.js", import.meta.url),
);

let browser;
let experimentScript;
let fontCss;
const realRolloutPath = process.env.CODEWIDE_TIMELINE_REAL_ROLLOUT;

before(async () => {
  const [regular, medium, semibold] = await Promise.all([
    readFont("RobotoFlex-Regular.ttf"),
    readFont("RobotoFlex-Medium.ttf"),
    readFont("RobotoFlex-SemiBold.ttf"),
  ]);
  fontCss = [
    fontFace("RobotoFlex-Regular", regular, 400),
    fontFace("RobotoFlex-Medium", medium, 500),
    fontFace("RobotoFlex-SemiBold", semibold, 600),
  ].join("\n");
  const result = await build({
    absWorkingDir: androidRoot,
    alias: {
      "@legendapp/list/react-native": legendListNativeEntry,
      "expo-clipboard": "./experiments/timeline-row-height-accuracy/expo-clipboard-web-stub.ts",
      "expo-font": "./experiments/markdown-virtualization/expo-font-web-stub.ts",
      "react-native": "react-native-web",
    },
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      global: "globalThis",
    },
    entryPoints: ["experiments/timeline-row-height-accuracy/experiment.tsx"],
    format: "iife",
    loader: { ".js": "jsx", ".ttf": "dataurl" },
    logLevel: "silent",
    platform: "browser",
    plugins: [
      {
        name: "timeline-height-browser-boundaries",
        setup(buildContext) {
          buildContext.onResolve({ filter: /\/ui\/MessageActionMenu$/ }, () => ({
            path: join(
              androidRoot,
              "experiments/timeline-row-height-accuracy/message-action-menu-web-stub.tsx",
            ),
          }));
        },
      },
    ],
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".json",
    ],
    write: false,
  });
  experimentScript = result.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

function fontFace(name, base64, weight) {
  return `@font-face { font-family: "${name}"; src: url(data:font/ttf;base64,${base64}) format("truetype"); font-style: normal; font-weight: ${String(weight)}; }`;
}

async function readFont(name) {
  return (await readFile(new URL(`../assets/fonts/${name}`, import.meta.url))).toString("base64");
}

async function scan(mode, options = {}) {
  const geometry = options.geometry ?? { density: 1, fontScale: 1, viewportWidth: 412 };
  const page = await browser.newPage({
    viewport: { height: 900, width: Math.ceil(geometry.viewportWidth) },
  });
  const errors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await page.setContent(`<!doctype html><html><head><style>
    ${fontCss}
    html, body, #root { height: 100%; margin: 0; overflow: hidden; width: 100%; }
    * { box-sizing: border-box; }
    body { background: #0f1115; }
  </style></head><body><div id="root"></div></body></html>`);
  await page.evaluate(
    async ({ includeActivity, selectedGeometry, selectedMode, sources }) => {
      window.process = { env: { NODE_ENV: "production" } };
      window.__TIMELINE_HEIGHT_GEOMETRY__ = selectedGeometry;
      window.__TIMELINE_HEIGHT_INCLUDE_ACTIVITY__ = includeActivity;
      window.__TIMELINE_HEIGHT_MODE__ = selectedMode;
      window.__TIMELINE_HEIGHT_SOURCES__ = sources;
      await Promise.all([
        document.fonts.load('14px "RobotoFlex-Regular"'),
        document.fonts.load('14px "RobotoFlex-Medium"'),
        document.fonts.load('14px "RobotoFlex-SemiBold"'),
      ]);
      await document.fonts.ready;
    },
    {
      includeActivity: options.includeActivity === true,
      selectedGeometry: geometry,
      selectedMode: mode,
      sources: options.sources,
    },
  );
  await page.addScriptTag({ content: experimentScript });
  try {
    await page.waitForFunction(
      () => window.timelineHeightAccuracyExperiment?.ready() === true,
      undefined,
      { timeout: 5_000 },
    );
  } catch (error) {
    throw new Error(
      `Height experiment did not become ready: ${JSON.stringify({ consoleErrors, errors })}`,
      { cause: error },
    );
  }
  try {
    const result = await page.evaluate(() => window.timelineHeightAccuracyExperiment.scan());
    assert.deepEqual(errors, []);
    return result;
  } finally {
    await page.close();
  }
}

async function realFinalAnswers(path) {
  const answersByTurn = new Map();
  let turnId = "unscoped";
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.type === "turn_context" && typeof row.payload?.turn_id === "string") {
      turnId = row.payload.turn_id;
      continue;
    }
    if (
      row.type !== "response_item" ||
      row.payload?.type !== "message" ||
      row.payload?.role !== "assistant"
    ) {
      continue;
    }
    const text = (row.payload.content ?? [])
      .filter((content) => content?.type === "output_text" && typeof content.text === "string")
      .map((content) => content.text)
      .join("\n");
    if (text === "") {
      continue;
    }
    const answers = answersByTurn.get(turnId) ?? [];
    answers.push({ phase: row.payload.phase, text });
    answersByTurn.set(turnId, answers);
  }
  return [...answersByTurn.values()].flatMap((answers) => {
    const finals = answers.filter((answer) => answer.phase === "final_answer");
    const selected = finals.at(-1) ?? answers.at(-1);
    return selected === undefined ? [] : [selected.text];
  });
}

function rowError(row) {
  if (row.calculated.status !== "exact") {
    return null;
  }
  return row.calculated.size - row.allocatedHeight;
}

test(
  "production Pretext sizes bypass LegendList measurement across a long answer",
  { timeout: 180_000 },
  async (context) => {
    const pretextNatural = await scan("pretext-natural");
    const premeasured = await scan("premeasured");
    assert.equal(premeasured.rows.length, pretextNatural.rows.length);
    assert.ok(
      pretextNatural.rows.length >= 120,
      `Expected a long thread, got ${pretextNatural.rows.length}`,
    );

    const naturalByKey = new Map(pretextNatural.rows.map((row) => [row.key, row]));
    const exactRows = premeasured.rows.filter((row) => row.calculated.status === "exact");
    const pretextTextRows = premeasured.rows.filter((row) =>
      ["blockquote", "heading", "list", "paragraph"].includes(row.nodeType),
    );
    assert.ok(exactRows.length >= 100, `Expected Pretext exact rows, got ${exactRows.length}`);
    assert.ok(
      pretextTextRows.length >= 90,
      `Expected wrapped text rows, got ${pretextTextRows.length}`,
    );
    const exactTextRows = pretextTextRows.filter((row) => row.calculated.status === "exact");
    const dynamicTextRows = pretextTextRows.filter((row) => row.calculated.status === "dynamic");
    assert.ok(
      exactTextRows.length >= 80,
      `Expected Pretext-owned wrapped text, got ${exactTextRows.length} exact rows`,
    );
    assert.ok(
      dynamicTextRows.every((row) =>
        [
          "composite-row",
          "leading-activity",
          "markdown-measurement-error",
          "markdown-measurement-unavailable",
          "streaming",
          "trailing-artifacts",
        ].includes(row.calculated.reason),
      ),
      `Wrapped text fell through for an unsupported reason: ${JSON.stringify(
        dynamicTextRows.map((row) => row.calculated.reason),
      )}`,
    );

    const mismatches = exactRows
      .map((row) => {
        const natural = naturalByKey.get(row.key);
        assert.ok(natural, `Natural Pretext render did not mount ${row.key}`);
        return {
          naturalHeight: natural.allocatedHeight,
          contentHeight: row.contentHeight,
          error: row.calculated.size - natural.allocatedHeight,
          index: row.index,
          nodeType: row.nodeType,
          placement: row.placement,
          predictedHeight: row.calculated.size,
        };
      })
      .filter((row) => Math.abs(row.error) > 1);

    assert.equal(
      mismatches.length,
      0,
      `Exact row heights diverged from their Pretext-owned render:\n${JSON.stringify(
        mismatches.slice(0, 30),
        null,
        2,
      )}`,
    );
    for (const row of exactRows) {
      assert.ok(Math.abs(row.allocatedHeight - row.calculated.size) <= 0.5, JSON.stringify(row));
    }

    const errors = exactRows.map(rowError).filter((value) => value !== null);
    assert.ok(errors.every((error) => Math.abs(error) <= 1));
    context.diagnostic(
      JSON.stringify({
        dynamicReasons: Object.fromEntries(
          Object.entries(
            Object.groupBy(
              pretextNatural.rows.filter((row) => row.calculated.status === "dynamic"),
              (row) => row.calculated.reason,
            ),
          ).map(([reason, rows]) => [reason, rows.length]),
        ),
        dynamicRows: pretextNatural.rows.length - exactRows.length,
        exactRows: exactRows.length,
        maxAbsoluteError: Math.max(...errors.map((error) => Math.abs(error))),
        totalRows: pretextNatural.rows.length,
      }),
    );
  },
);

test("collapsed completed activity is part of the exact physical row height", async () => {
  const [plain, withActivity] = await Promise.all([
    scan("pretext-natural", { sources: ["Final answer"] }),
    scan("pretext-natural", { includeActivity: true, sources: ["Final answer"] }),
  ]);
  const plainRow = plain.rows[0];
  const activityRow = withActivity.rows[0];
  assert.ok(plainRow !== undefined);
  assert.ok(activityRow !== undefined);
  assert.equal(plainRow.calculated.status, "exact");
  assert.equal(activityRow.calculated.status, "exact");
  assert.ok(Math.abs(plainRow.allocatedHeight - plainRow.calculated.size) <= 0.5);
  assert.ok(Math.abs(activityRow.allocatedHeight - activityRow.calculated.size) <= 0.5);
  assert.equal(activityRow.allocatedHeight - plainRow.allocatedHeight, 20);
});

test(
  "production Pretext audits a real long thread without native list measurement",
  { skip: realRolloutPath === undefined, timeout: 180_000 },
  async (context) => {
    assert.ok(realRolloutPath !== undefined);
    const sources = await realFinalAnswers(realRolloutPath);
    const geometry = {
      density: 2.3375000953674316,
      fontScale: 1,
      viewportWidth: 880 / 2.3375000953674316,
    };
    const [natural, pretextNatural] = await Promise.all([
      scan("natural", { geometry, sources }),
      scan("pretext-natural", { geometry, sources }),
    ]);
    assert.ok(sources.length >= 100, `Expected a real long thread, got ${sources.length} turns`);
    assert.ok(
      pretextNatural.rows.length >= 450,
      `Expected many physical rows, got ${pretextNatural.rows.length}`,
    );
    assert.equal(pretextNatural.rows.length, natural.rows.length);

    const exactRows = pretextNatural.rows.filter((row) => row.calculated.status === "exact");
    const pretextTextRows = pretextNatural.rows.filter((row) =>
      ["blockquote", "heading", "list", "paragraph"].includes(row.nodeType),
    );
    assert.ok(pretextTextRows.length > 0, "Expected wrapped text rows in the real thread");
    const exactTextRows = pretextTextRows.filter((row) => row.calculated.status === "exact");
    const dynamicTextRows = pretextTextRows.filter((row) => row.calculated.status === "dynamic");
    assert.ok(exactTextRows.length > 0, "Expected Pretext-owned text in the real thread");
    assert.ok(
      dynamicTextRows.every((row) =>
        [
          "composite-row",
          "leading-activity",
          "markdown-measurement-error",
          "markdown-measurement-unavailable",
          "streaming",
          "trailing-artifacts",
        ].includes(row.calculated.reason),
      ),
      `Real wrapped text fell through for an unsupported reason: ${JSON.stringify(
        dynamicTextRows.map((row) => row.calculated.reason),
      )}`,
    );
    const textEstimateErrors = exactTextRows.map((row) => ({
      bubbleContentWidth: row.bubbleContentWidth,
      error: row.calculated.size - row.allocatedHeight,
      nodeType: row.nodeType,
      textFeatures: row.textFeatures,
      textShape: row.textShape,
    }));
    // Leading and trailing slices may keep a short intrinsic width. Middle slices fill the
    // bubble cap, so they are the rows that prove the renderer and Pretext share that cap.
    const boundedTextRows = exactTextRows.filter(
      (row) => row.placement === "middle" && row.bubbleContentWidth > 0,
    );
    const expectedContentWidth = geometry.viewportWidth - 16 * 4 - 32;
    assert.ok(boundedTextRows.length >= 100, "Expected bounded real-thread text rows");
    assert.ok(
      boundedTextRows.every((row) => Math.abs(row.bubbleContentWidth - expectedContentWidth) <= 1),
      "Pretext and the real renderer must receive the same content width",
    );
    const naturalByKey = new Map(natural.rows.map((row) => [row.key, row]));
    const disabledRendererErrors = exactRows.map((row) => {
      const disabledRow = naturalByKey.get(row.key);
      assert.ok(disabledRow, `Natural renderer did not mount ${row.key}`);
      return row.calculated.size - disabledRow.allocatedHeight;
    });
    context.diagnostic(
      JSON.stringify({
        textEstimateErrors: Object.fromEntries(
          ["plain", "rich"].map((shape) => {
            const values = textEstimateErrors.filter((row) => row.textShape === shape);
            return [
              shape,
              {
                count: values.length,
                maxUnderestimate: Math.min(0, ...values.map((row) => row.error)),
                maxOverestimate: Math.max(0, ...values.map((row) => row.error)),
                mismatches: values.filter((row) => Math.abs(row.error) > 1).length,
              },
            ];
          }),
        ),
        disabledRendererComparison: {
          maxUnderestimate: Math.min(0, ...disabledRendererErrors),
          maxOverestimate: Math.max(0, ...disabledRendererErrors),
          mismatches: disabledRendererErrors.filter((error) => Math.abs(error) > 1).length,
        },
        mismatchesByFeatures: Object.fromEntries(
          Object.entries(
            Object.groupBy(
              textEstimateErrors.filter((row) => Math.abs(row.error) > 1),
              (row) => `${row.nodeType}:${row.textFeatures}`,
            ),
          ).map(([key, values]) => [
            key,
            {
              count: values.length,
              maxUnderestimate: Math.min(0, ...values.map((row) => row.error)),
              maxOverestimate: Math.max(0, ...values.map((row) => row.error)),
              widths: [...new Set(values.map((row) => row.bubbleContentWidth))].slice(0, 10),
            },
          ]),
        ),
      }),
    );
    const errors = exactRows.map((row) => ({
      actualHeight: row.allocatedHeight,
      error: row.calculated.size - row.allocatedHeight,
      index: row.index,
      nodeType: row.nodeType,
      placement: row.placement,
      predictedHeight: row.calculated.size,
    }));
    const mismatches = errors.filter((row) => Math.abs(row.error) > 1);
    const underestimated = mismatches.filter((row) => row.error < 0);
    const overestimated = mismatches.filter((row) => row.error > 0);
    context.diagnostic(
      JSON.stringify({
        dynamicReasons: Object.fromEntries(
          Object.entries(
            Object.groupBy(
              pretextNatural.rows.filter((row) => row.calculated.status === "dynamic"),
              (row) => row.calculated.reason,
            ),
          ).map(([reason, rows]) => [reason, rows.length]),
        ),
        dynamicRows: pretextNatural.rows.length - exactRows.length,
        exactRowsByPlacement: Object.fromEntries(
          Object.entries(Object.groupBy(exactRows, (row) => row.placement)).map(
            ([placement, placementRows]) => [placement, placementRows.length],
          ),
        ),
        exactRows: exactRows.length,
        maxUnderestimate: Math.min(0, ...errors.map((row) => row.error)),
        maxOverestimate: Math.max(0, ...errors.map((row) => row.error)),
        mismatches: mismatches.length,
        overestimated: overestimated.length,
        totalRows: pretextNatural.rows.length,
        turns: sources.length,
        underestimated: underestimated.length,
      }),
    );
    assert.equal(
      mismatches.length,
      0,
      `Pretext-owned real-thread rows diverged from calculated heights:\n${JSON.stringify(
        mismatches.slice(0, 30),
        null,
        2,
      )}`,
    );
  },
);
