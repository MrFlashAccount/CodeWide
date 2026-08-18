import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const editor = path.join(root, "apps/android/android/app/src/main/assets/code-review-editor.html");
const unifiedOutput = path.join(root, "test-results/code-review-editor-unified.png");
const splitOutput = path.join(root, "test-results/code-review-editor-split.png");
const treeOutput = path.join(root, "test-results/code-review-editor-tree.png");
const inlineCommentOutput = path.join(root, "test-results/code-review-editor-inline-comment.png");
const filePath = "apps/android/src/rendering/CodeReviewWorkspace.tsx";
const deepFilePath = "apps/android/src/features/conversation/rendering/markdown/extensions/diagrams/mermaid/MermaidDiagramRenderer.tsx";
const beforeLines = [
  'import { useState } from "react";',
  'import { View } from "react-native";',
  "",
  "type ReviewProps = {",
  "  path: string;",
  "  patch: string;",
  "};",
  "",
  "export function CodeReviewWorkspace({ path, patch }: ReviewProps) {",
  "  const [comments, setComments] = useState([]);",
  "  return <LegacyDiff source={patch} />;",
  "}",
  "",
  "function LegacyDiff({ source }: { source: string }) {",
  "  return <View>{source}</View>;",
  "}",
  "",
  "export const reviewVersion = 1;",
];
const afterLines = [
  'import { useState } from "react";',
  'import { View } from "react-native";',
  "",
  "type ReviewProps = {",
  "  path: string;",
  "  patch: string;",
  "};",
  "",
  "export function CodeReviewWorkspace({ path, patch }: ReviewProps) {",
  "  const [comments, setComments] = useState([]);",
  "  return (",
  "    <CodeReviewEditor",
  "      path={path}",
  "      document={patch}",
  "      comments={comments}",
  "      onComment={setComments}",
  "    />",
  "  );",
  "}",
  "",
  "export const reviewVersion = 2;",
];
const comments = [{ id: "review-1", path: filePath, line: 14, side: "new", coordinate: "file", body: "Keep this renderer reusable." }];
const files = [
  { path: filePath, treePath: filePath, status: "modified", additions: 9, deletions: 2 },
  { path: "apps/android/src/rendering/CodeReviewEditor.native.tsx", treePath: "apps/android/src/rendering/CodeReviewEditor.native.tsx", status: "modified", additions: 84, deletions: 31 },
  { path: "apps/android/src/rendering/new-review-model.ts", treePath: "apps/android/src/rendering/new-review-model.ts", status: "added", additions: 120, deletions: 0 },
  { path: deepFilePath, treePath: deepFilePath, status: "modified", additions: 18, deletions: 7 },
  { path: "apps/android/src/features/index.ts", treePath: "apps/android/src/features/index.ts", status: "modified", additions: 1, deletions: 1 },
  { path: "apps/android/src/features/conversation/index.ts", treePath: "apps/android/src/features/conversation/index.ts", status: "modified", additions: 1, deletions: 1 },
  { path: "apps/android/src/features/conversation/rendering/index.ts", treePath: "apps/android/src/features/conversation/rendering/index.ts", status: "modified", additions: 1, deletions: 1 },
  { path: "apps/android/src/features/conversation/rendering/markdown/index.ts", treePath: "apps/android/src/features/conversation/rendering/markdown/index.ts", status: "modified", additions: 1, deletions: 1 },
  { path: "apps/android/src/features/conversation/rendering/markdown/extensions/index.ts", treePath: "apps/android/src/features/conversation/rendering/markdown/extensions/index.ts", status: "modified", additions: 1, deletions: 1 },
  { path: "apps/android/src/features/conversation/rendering/markdown/extensions/diagrams/index.ts", treePath: "apps/android/src/features/conversation/rendering/markdown/extensions/diagrams/index.ts", status: "modified", additions: 1, deletions: 1 },
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" });
  page.on("pageerror", (error) => console.error(error));
  await page.goto(pathToFileURL(editor).href);
  let sequence = 0;
  const send = async (command, payload) => {
    sequence += 1;
    await page.evaluate((message) => {
      window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }, { version: 1, sequence, command, payload });
  };
  const patch = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
  await send("workspace", { files, revision: "fixture-tree-v1", selectedPath: filePath, sidebarOpen: true, compact: false });
  await send("settings", { mode: "unified", wrapLines: false });
  await send("comments", comments);
  await send("document", {
    requestId: 1,
    document: { path: filePath, source: afterLines.join("\n"), patches: [{ kind: "update", diff: patch }], revision: "fixture-document-v1" },
  });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: unifiedOutput });
  await page.locator('diffs-container [data-column-number="10"] [data-line-number-content]').last().click();
  const inlineComment = page.locator("diffs-container .review-composer-input");
  await inlineComment.waitFor({ state: "visible", timeout: 2_000 });
  await inlineComment.fill("This comment stays attached to line 10.");
  await page.waitForTimeout(150);
  await page.screenshot({ path: inlineCommentOutput });
  await page.setViewportSize({ width: 900, height: 720 });
  await send("workspace", { files, revision: "fixture-tree-v1", selectedPath: deepFilePath, sidebarOpen: true, compact: false });
  await page.waitForTimeout(100);
  const deepRowLayout = await page.locator("file-tree-container").evaluate((host, path) => {
    const row = host.shadowRoot?.querySelector(`[data-item-path="${CSS.escape(path)}"]`);
    const content = row?.querySelector('[data-item-section="content"]');
    if (!(row instanceof HTMLElement) || !(content instanceof HTMLElement)) return null;
    const rowRect = row.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      contentWidth: contentRect.width,
      visibleWithinRow: contentRect.left < rowRect.right && contentRect.right > rowRect.left,
    };
  }, deepFilePath);
  if (deepRowLayout === null || !deepRowLayout.visibleWithinRow || deepRowLayout.contentWidth < 72) {
    throw new Error(`Deep file row is not readable: ${JSON.stringify(deepRowLayout)}`);
  }
  await page.screenshot({ path: treeOutput });
  await page.setViewportSize({ width: 1280, height: 720 });
  await send("workspace", { files, revision: "fixture-tree-v1", selectedPath: filePath, sidebarOpen: false, compact: false });
  await send("settings", { mode: "split", wrapLines: false });
  await page.waitForTimeout(1_000);
  await page.screenshot({ path: splitOutput });
  console.log(unifiedOutput);
  console.log(splitOutput);
  console.log(treeOutput);
  console.log(inlineCommentOutput);
} finally {
  await browser.close();
}
