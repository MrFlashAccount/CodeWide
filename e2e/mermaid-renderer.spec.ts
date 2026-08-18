import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";

const rendererUrl = pathToFileURL(`${process.cwd()}/apps/android/android/app/src/main/assets/mermaid-renderer.html`).href;

test("bundled fullscreen Mermaid stays visible across repeated renders", async ({ page }) => {
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

  for (let requestId = 1; requestId <= 12; requestId += 1) {
    await page.evaluate((id) => {
      const runtime = window as typeof window & { renderMermaid(source: string, requestId: number, mode: string): Promise<void> };
      return runtime.renderMermaid(`flowchart LR\n  Phone${id} --> Relay\n  Relay --> Companion\n  Companion --> Codex`, id, "fullscreen");
    }, requestId);
    await expect.poll(async () => await page.evaluate((id) => {
      const messages = (window as typeof window & { __rendererMessages?: string[] }).__rendererMessages ?? [];
      return messages.some((value) => {
        const message = JSON.parse(value) as { type?: string; requestId?: number };
        return message.type === "rendered" && message.requestId === id;
      });
    }, requestId)).toBe(true);

    const geometry = await page.locator("#canvas svg").evaluate((svg) => {
      const bounds = svg.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        left: bounds.left,
        top: bounds.top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.width).toBeGreaterThan(20);
    expect(geometry.height).toBeGreaterThan(20);
    expect(geometry.left).toBeLessThan(geometry.viewportWidth);
    expect(geometry.top).toBeLessThan(geometry.viewportHeight);
    expect(geometry.left + geometry.width).toBeGreaterThan(0);
    expect(geometry.top + geometry.height).toBeGreaterThan(0);
  }
});
