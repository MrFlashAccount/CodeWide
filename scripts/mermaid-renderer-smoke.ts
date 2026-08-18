/// <reference lib="dom" />

import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";

const root = process.cwd();
const assets = path.join(root, "apps/android/android/app/src/main/assets");
const output = path.join(root, "test-results/mermaid-renderer");

await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const fileName = request.url === "/" ? "mermaid-renderer.html" : path.basename(request.url ?? "");
  if (!["mermaid-renderer.html", "mermaid.min.js", "panzoom.min.js"].includes(fileName)) {
    response.writeHead(404).end();
    return;
  }
  const body = await readFile(path.join(assets, fileName));
  response.writeHead(200, { "content-type": fileName.endsWith(".html") ? "text/html" : "text/javascript" });
  response.end(body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Could not bind Mermaid test server");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 760 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    (window as typeof window & { __rendererMessages: unknown[]; ReactNativeWebView: { postMessage(value: string): void } }).__rendererMessages = [];
    (window as typeof window & { ReactNativeWebView: { postMessage(value: string): void } }).ReactNativeWebView = {
      postMessage(value) {
        (window as typeof window & { __rendererMessages: unknown[] }).__rendererMessages.push(JSON.parse(value));
      },
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}/mermaid-renderer.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof (window as typeof window & { renderMermaid?: unknown }).renderMermaid === "function");
  await render(page, "inline", 1);
  const inline = await dimensions(page);
  await page.screenshot({ path: path.join(output, "inline.png") });
  if (inline.svg.width < 450 || inline.svg.height < 24 || inline.svg.height > 440) {
    throw new Error(`Inline Mermaid geometry is invalid: ${JSON.stringify(inline)}`);
  }

  await render(page, "fullscreen", 2);
  const before = await page.locator("#canvas").evaluate((element) => getComputedStyle(element).transform);
  await page.mouse.move(260, 380);
  await page.mouse.down();
  await page.mouse.move(340, 450, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator("#canvas").evaluate((element) => getComputedStyle(element).transform);
  if (after === before) throw new Error("Fullscreen Mermaid did not respond to drag");
  await page.evaluate(() => (window as typeof window & { diagramZoom(factor: number, requestId: number): void }).diagramZoom(1.25, 3));
  await page.screenshot({ path: path.join(output, "fullscreen-pan-zoom.png") });
  process.stdout.write(`${JSON.stringify({ ok: true, inline, dragTransformChanged: after !== before, screenshots: output }, null, 2)}\n`);
} finally {
  await browser.close();
  server.close();
}

async function render(page: Page, mode: "inline" | "fullscreen", requestId: number): Promise<void> {
  const source = [
    "flowchart LR",
    "  Android[Android app] -->|WSS| Companion[Remote companion]",
    "  Companion --> Codex[Codex app server]",
    "  Codex --> Tools[Tools and files]",
  ].join("\n");
  await page.evaluate(({ value, id, displayMode }) => {
    (window as typeof window & { renderMermaid(source: string, requestId: number, mode: string): Promise<void> }).renderMermaid(value, id, displayMode);
  }, { value: source, id: requestId, displayMode: mode });
  await page.waitForFunction((id) => {
    const messages = (window as typeof window & { __rendererMessages: Array<{ type?: string; requestId?: number }> }).__rendererMessages;
    return messages.some((message) => message.type === "rendered" && message.requestId === id);
  }, requestId);
}

async function dimensions(page: Page) {
  const rootBox = await page.locator("#root").boundingBox();
  const canvasBox = await page.locator("#canvas").boundingBox();
  const svgBox = await page.locator("#canvas svg").boundingBox();
  if (rootBox === null || canvasBox === null || svgBox === null) throw new Error("Mermaid renderer geometry is missing");
  return {
    root: { width: rootBox.width, height: rootBox.height },
    canvas: { width: canvasBox.width, height: canvasBox.height },
    svg: { width: svgBox.width, height: svgBox.height },
  };
}
