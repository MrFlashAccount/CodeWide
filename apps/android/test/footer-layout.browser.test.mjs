// Real browser layout supplements native render tests, which do not execute Yoga.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let browser;
let script;
before(async () => {
  const bundle = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { Text, View } from "react-native";
      import { MessageFooterRow, MessageFooterStatus } from "./src/rendering/MessageFooterRow";
      const label = { fontSize: 12, lineHeight: 16, color: "white" };
      createRoot(document.getElementById("app")).render(
        <View style={{ alignSelf: "flex-start", maxWidth: "100%", flexShrink: 1 }}>
          <Text style={label}>OK</Text>
          <MessageFooterRow time="22:18" tokens={<Text numberOfLines={1} style={label}>↓815K ↑12K</Text>}
            cost={<Text numberOfLines={1} style={label}>$12.50</Text>} changes={<Text numberOfLines={1} style={label}>Changes</Text>}>
            <MessageFooterStatus><Text style={label}>● 12s</Text></MessageFooterStatus>
          </MessageFooterRow>
        </View>
      );
    `, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "react-native": "react-native-web" }, define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); });

test("an intrinsic bubble keeps one footer line when its available width changes", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="app" style="display:flex;width:420px;background:#222"></div>');
    await page.addScriptTag({ content: script });
    const footer = page.getByTestId("turn-footer");
    await expect(footer).toBeVisible();
    const height = (await footer.boundingBox()).height;
    for (const width of [260, 180, 420]) {
      await page.locator("#app").evaluate((node, width) => { node.style.width = `${width}px`; }, width);
      await expect.poll(async () => (await footer.boundingBox()).width).toBeLessThanOrEqual(width);
      await expect.poll(async () => (await footer.boundingBox()).height).toBe(height);
      const bounds = await footer.boundingBox();
      const changes = await page.getByText("Changes", { exact: true }).boundingBox();
      assert.ok(changes.x + changes.width <= bounds.x + bounds.width, "Changes stays within the bubble");
    }
    await expect.poll(() => page.getByTestId("turn-footer-tokens-segment").evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
  } finally { await page.close(); }
});
