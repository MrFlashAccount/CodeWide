import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";

const rendererUrl = pathToFileURL(`${process.cwd()}/apps/android/android/app/src/main/assets/ascii-diagram-renderer.html`).href;
const architecture = `                 TypeScript source
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
   Oxc, Rust                    tsgo sidecar, Go
 AST + scopes + CFG        Program + TypeChecker
          │               symbols/types/signatures
          └─────────────┬─────────────┘
                        ▼
                наш Typed HIR
             CFG + places + aliases
                        ▼
            effect inference engine
                        ▼
        contracts / diagnostics / fixes`;

test("bundled Svgbob renders generated ASCII architecture as scalable SVG", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 620 });
  await page.addInitScript(() => {
    const messages: string[] = [];
    Object.assign(window, {
      __rendererMessages: messages,
      ReactNativeWebView: { postMessage: (value: string) => messages.push(value) },
    });
  });
  await page.goto(rendererUrl);
  await expect.poll(async () => await page.evaluate(() => {
    const messages = (window as typeof window & { __rendererMessages?: string[] }).__rendererMessages ?? [];
    return messages.some((value) => JSON.parse(value).type === "ready");
  })).toBe(true);

  await page.evaluate((source) => {
    const runtime = window as typeof window & { renderAsciiDiagram(source: string, requestId: number, mode: string): Promise<void> };
    return runtime.renderAsciiDiagram(source, 1, "fullscreen");
  }, architecture);
  await expect.poll(async () => await page.evaluate(() => {
    const messages = (window as typeof window & { __rendererMessages?: string[] }).__rendererMessages ?? [];
    return messages.some((value) => {
      const message = JSON.parse(value) as { type?: string; requestId?: number };
      return message.type === "rendered" && message.requestId === 1;
    });
  })).toBe(true);

  await expect(page.locator("#canvas svg.svgbob")).toBeVisible();
  expect(await page.locator("#canvas svg line").count()).toBeGreaterThan(5);
  expect(await page.locator("#canvas svg polygon").count()).toBeGreaterThan(2);
  await expect(page.locator("#canvas svg text").filter({ hasText: "TypeScript" })).toBeVisible();
  await expect(page.locator("#canvas svg text").filter({ hasText: "source" })).toBeVisible();
  await expect(page.locator("#canvas svg rect.backdrop")).toHaveCSS("fill", "rgba(0, 0, 0, 0)");
});
