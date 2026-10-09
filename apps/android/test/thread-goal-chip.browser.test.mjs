// DOM layout checks the real chip; Jest render tests do not execute a layout engine.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
const androidRoot = fileURLToPath(new URL("../", import.meta.url));
let browser;
let script;

before(async () => {
  const bundle = await build({
    absWorkingDir: androidRoot,
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { View } from "react-native";
        import { ThreadGoalChip } from "./src/features/goal/ThreadGoalChip";
        import { ThreadGoalMenu } from "./src/features/goal/ThreadGoalMenu";
        const goal = {
          createdAt: 1, objective: window.probeObjective, status: window.probeStatus,
          threadId: "thread", timeUsedSeconds: 0, tokenBudget: null, tokensUsed: 0, updatedAt: 2,
        };
        createRoot(document.getElementById("app")).render(
          <View style={{ height: 200, width: "100%" }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {window.probeMenu ? <ThreadGoalMenu goal={goal} currentTurnId={null}
                captureGoalLifecycle={() => ({ clear: async () => true, setStatus: async () => goal })}
                onBeforeOpen={() => {}} onEdit={() => {}} onInterrupt={undefined} /> :
                <ThreadGoalChip goal={goal} onPress={() => { window.probePressed = true; }} />}
            </View>
          </View>
        );
      `,
      loader: "tsx",
      resolveDir: androidRoot,
    },
    plugins: [
      {
        name: "goal-display-boundaries",
        setup(builder) {
          // Match Metro's web platform entry, retaining the library's real SVG renderer.
          builder.onResolve({ filter: /^react-native-svg$/ }, () => ({
            path: requireAndroid.resolve("react-native-svg/lib/module/ReactNativeSVG.web.js"),
          }));
          builder.onResolve({ filter: /\/ui\/Typography$/ }, () => ({
            path: fileURLToPath(new URL("../src/ui/AppText.tsx", import.meta.url)),
          }));
          builder.onResolve({ filter: /^@expo\/vector-icons/ }, () => ({
            path: "icons",
            namespace: "probe",
          }));
          builder.onResolve({ filter: /\/ui\/WaveText$/ }, () => ({ path: "wave", namespace: "wave" }));
          builder.onLoad({ filter: /.*/, namespace: "wave" }, () => ({
            contents: `import React from "react"; import { Text } from "react-native";
              export function WaveText({text, style}) { return <Text style={style}>{text}</Text>; }`,
            loader: "tsx", resolveDir: androidRoot,
          }));
          builder.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
            contents: `import React from "react"; import { View } from "react-native";
            export default function Icon({ size }) { return <View style={{ height: size, width: size }} />; }`,
            loader: "tsx",
            resolveDir: androidRoot,
          }));
        },
      },
    ],
    alias: { "react-native": "react-native-web" },
    resolveExtensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".json"],
    bundle: true,
    define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

for (const objective of [
  "Ship goal UI",
  "Довести длинную цель до результата без потери управления. ".repeat(20),
  "unbrokentext".repeat(100),
]) {
  test(`goal text stays inside the chip: ${objective.slice(0, 30)}`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="app" style="width:420px;background:#222"></div>');
      await page.evaluate(
        ({ objective }) => {
          window.probeObjective = objective;
          window.probeStatus = "budgetLimited";
        },
        { objective },
      );
      await page.addScriptTag({ content: script });
      const chip = page.getByTestId("thread-goal-chip");
      await expect(chip).toBeVisible();
      for (const width of [420, 320, 240, 180]) {
        await page.locator("#app").evaluate((node, width) => {
          node.style.width = `${width}px`;
        }, width);
        await expect.poll(async () => (await chip.boundingBox()).width).toBeLessThanOrEqual(width);
        const layout = await chip.evaluate((node) => {
          const bounds = node.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            height: bounds.height,
            children: Array.from(node.children, (child) => {
              const rect = child.getBoundingClientRect();
              return { left: rect.left, right: rect.right, height: rect.height };
            }),
          };
        });
        for (const child of layout.children) {
          assert.ok(
            child.left >= layout.left - 1 && child.right <= layout.right + 1,
            `every chip segment fits at width ${width}: ${JSON.stringify(layout)}`,
          );
          assert.ok(child.height <= layout.height, "objective remains on one line");
        }
        if (width >= 240) {
          const statusFits = await page
            .getByText("Budget limited", { exact: true })
            .evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
          assert.ok(statusFits, "the status stays readable while the objective is truncated");
        }
        await expect(page.getByText(objective, { exact: true })).toHaveCount(0);
      }
      await chip.click();
      assert.equal(await page.evaluate(() => window.probePressed), true);
      await expect(chip).toHaveAttribute("aria-label", `Goal, Budget limited, ${objective}`);
    } finally {
      await page.close();
    }
  });
}

test("long goal reader preserves metadata and actions on narrow screens", async () => {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 740 },
    { width: 736, height: 740 },
    { width: 736, height: 390 },
  ]) {
    const { width, height } = viewport;
    const page = await browser.newPage({ viewport });
    try {
      await page.setContent('<div id="app" style="width:100%;background:#222"></div>');
      await page.evaluate(() => {
        window.probeMenu = true;
        window.probeObjective = "Довести работу до результата, проверить изменения и сообщить итог. ".repeat(80);
        window.probeStatus = "active";
      });
      await page.addScriptTag({ content: script });
      await page.getByTestId("thread-goal-chip").click();
      const reader = page.getByTestId("goal-objective-reader");
      const readerBox = await reader.boundingBox();
      assert.ok(readerBox.height > 0, "reader has an explicit nonzero viewport");
      for (const name of ["Pause goal", "Edit goal", "Stop goal"]) {
        const action = page.getByRole("button", { name });
        await expect(action).toBeVisible();
        const box = await action.boundingBox();
        assert.ok(box.y + box.height <= readerBox.y || box.y >= readerBox.y + readerBox.height, "actions stay outside the text reader");
        assert.ok(box.height >= 44 && box.y + box.height <= height, "actions fit and remain tappable");
        assert.ok(box.x >= 0 && box.x + box.width <= width, "action fits screen width");
        assert.ok(box.y + box.height <= readerBox.y, "all actions share the header above the reader");
        assert.ok(box.width >= 44, "icon-only actions have full square touch targets");
        await expect(action).toHaveText("");
        const glyph = action.locator("svg");
        await expect(glyph).toBeVisible();
        const glyphBox = await glyph.boundingBox();
        assert.ok(Math.abs(box.x + box.width / 2 - glyphBox.x - glyphBox.width / 2) <= 1, "real vector glyph is horizontally centered");
        assert.ok(Math.abs(box.y + box.height / 2 - glyphBox.y - glyphBox.height / 2) <= 1, "real vector glyph has no font-baseline offset");
      }
      await reader.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await expect(page.getByRole("button", { name: "Stop goal" })).toBeVisible();
      await expect(page.getByText("0 ms", { exact: true })).toBeVisible();
    } finally { await page.close(); }
  }
});

test("short goal grows only to its text height without a disclosure or blank reader", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
  try {
    await page.setContent('<style>body{margin:0;background:#181818}</style><div id="app" style="width:100%;background:#181818"></div>');
    await page.evaluate(() => {
      window.probeMenu = true;
      window.probeObjective = "Бейбисить PR до результата: отслеживать ревью и CI, разбирать финальные ошибки и выполнять только необходимые безопасные действия.";
      window.probeStatus = "blocked";
    });
    await page.addScriptTag({ content: script });
    await page.getByTestId("thread-goal-chip").click();
    const reader = page.getByTestId("goal-objective-reader");
    const text = page.getByTestId("goal-menu-objective");
    await expect.poll(async () => Math.abs((await reader.boundingBox()).height - (await text.boundingBox()).height)).toBeLessThanOrEqual(1);
    assert.ok((await reader.boundingBox()).height < 200);
    await expect(page.getByText("Collapse", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Status", { exact: true })).toHaveCount(0);
    if (process.env.CODEWIDE_GOAL_SCREENSHOT_PATH) {
      await page.waitForFunction(() => {
        let node = document.querySelector('[data-testid="thread-goal-menu"]');
        while (node) {
          if (Number.parseFloat(getComputedStyle(node).opacity) < 1) return false;
          node = node.parentElement;
        }
        return true;
      });
      await page.screenshot({ path: process.env.CODEWIDE_GOAL_SCREENSHOT_PATH });
    }
  } finally { await page.close(); }
});
