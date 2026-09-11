// Exercises the shipped WebView bundle, including Pierre, without a Companion or device.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openReview() {
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
  await page.addInitScript(() => {
    window.reviewEvents = [];
    window.ReactNativeWebView = { postMessage: (text) => window.reviewEvents.push(JSON.parse(text)) };
  });
  await page.goto(new URL("../android/app/src/main/assets/code-review-editor.html", import.meta.url).href);
  await page.waitForFunction(() => window.reviewEvents.some((event) => event.type === "ready"));
  return page;
}

async function send(page, command, payload) {
  await page.evaluate(({ command, payload }) => {
    window.reviewSequence = (window.reviewSequence ?? 0) + 1;
    window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ version: 1, sequence: window.reviewSequence, command, payload }) }));
  }, { command, payload });
}

const patch = (before, after) => ({ kind: "update", diff: `--- a/file.ts\n+++ b/file.ts\n@@ -20 +20 @@\n-${before}\n+${after}\n` });
const files = [{ path: "file.ts", treePath: "file.ts", status: "modified", additions: 1, deletions: 1 }];

test("activating the selected file returns from the compact file tree to its preview", async () => {
  const page = await openReview();
  try {
    const workspace = { files, revision: "files-1", selectedPath: "file.ts", sidebarOpen: true, compact: true };
    await send(page, "workspace", workspace);
    await page.locator('button[data-item-path="file.ts"]').click();
    await expect.poll(() => page.evaluate(() => window.reviewEvents.filter((event) => event.type === "fileSelect").map((event) => event.path))).toEqual(["file.ts"]);
    await send(page, "workspace", { ...workspace, sidebarOpen: false });
    await expect(page.getByText("Loading file…", { exact: true })).toBeVisible();
  } finally { await page.close(); }
});

test("renders every recorded edit even when no complete current file exists", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", { files, revision: "files-1", selectedPath: "file.ts", sidebarOpen: false, compact: true });
    await expect(page.getByText("Loading file…", { exact: true })).toBeVisible();
    for (const mode of ["unified", "split"]) {
      await send(page, "settings", { mode, wrapLines: false });
      await send(page, "document", { requestId: 1, document: { path: "file.ts", source: "", revision: "recorded-1", patches: [patch("beforeFirst", "afterFirst"), patch("beforeSecond", "afterSecond")] } });
      for (const text of ["beforeFirst", "afterFirst", "beforeSecond", "afterSecond"]) {
        await expect(page.getByText(text, { exact: true })).toBeVisible();
      }
      const first = await page.getByText("beforeFirst", { exact: true }).boundingBox();
      const second = await page.getByText("beforeSecond", { exact: true }).boundingBox();
      assert.ok(first !== null && second !== null && first.y < second.y, "recorded edits retain their original order");
    }
    assert.equal(await page.evaluate(() => window.reviewEvents.some((event) => event.type === "error")), false);
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(page.getByText("No source content", { exact: true })).toBeVisible();
  } finally { await page.close(); }
});

test("still renders a complete source file and a reconstructed diff", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", { files, revision: "files-1", selectedPath: "file.ts", sidebarOpen: false, compact: true });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", { requestId: 1, document: { path: "file.ts", source: "currentValue", revision: "complete-1", patches: [{ kind: "update", diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-previousValue\n+currentValue" }] } });
    await expect(page.getByText("previousValue", { exact: true })).toBeVisible();
    await expect(page.getByText("currentValue", { exact: true }).filter({ visible: true })).toBeVisible();
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(page.getByText("currentValue", { exact: true }).filter({ visible: true })).toBeVisible();
  } finally { await page.close(); }
});
