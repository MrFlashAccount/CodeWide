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
        centerDeltaX: Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2),
        centerDeltaY: Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
      };
    });
    expect(geometry.width).toBeGreaterThan(20);
    expect(geometry.height).toBeGreaterThan(20);
    expect(geometry.left).toBeLessThan(geometry.viewportWidth);
    expect(geometry.top).toBeLessThan(geometry.viewportHeight);
    expect(geometry.left + geometry.width).toBeGreaterThan(0);
    expect(geometry.top + geometry.height).toBeGreaterThan(0);
    expect(geometry.centerDeltaX).toBeLessThanOrEqual(1);
    expect(geometry.centerDeltaY).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 620, height: 920 });
  await expect.poll(async () => await page.locator("#canvas svg").evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    return Math.max(
      Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2),
      Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
    );
  })).toBeLessThanOrEqual(1);

  const stage = await page.locator("#stage").boundingBox();
  expect(stage).not.toBeNull();
  if (stage === null) return;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 + 90, stage.y + stage.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => await page.locator("#canvas svg").evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    return Math.max(
      Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2),
      Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
    );
  })).toBeGreaterThan(20);
  await page.evaluate(() => {
    const runtime = window as typeof window & { diagramReset(requestId: number): void };
    runtime.diagramReset(999);
  });
  await expect.poll(async () => await page.locator("#canvas svg").evaluate((svg) => {
    const bounds = svg.getBoundingClientRect();
    return Math.max(
      Math.abs(bounds.left + bounds.width / 2 - window.innerWidth / 2),
      Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2),
    );
  })).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    const runtime = window as typeof window & { diagramSetAnnotationMode(enabled: boolean): void };
    runtime.diagramSetAnnotationMode(true);
  });
  const diagram = await page.locator("#canvas svg").boundingBox();
  expect(diagram).not.toBeNull();
  if (diagram === null) return;
  await page.mouse.click(diagram.x + diagram.width / 2, diagram.y + diagram.height / 2);
  await expect.poll(async () => await page.evaluate(() => {
    const messages = (window as typeof window & { __rendererMessages?: string[] }).__rendererMessages ?? [];
    const parsed = messages.map((value) => JSON.parse(value) as { type?: string; requestId?: number; x?: number; y?: number });
    return parsed.findLast((message) => message.type === "reviewPoint" && message.requestId === 12) ?? null;
  })).not.toBeNull();
  const point = await page.evaluate(() => {
    const messages = (window as typeof window & { __rendererMessages?: string[] }).__rendererMessages ?? [];
    const parsed = messages.map((value) => JSON.parse(value) as { type?: string; requestId?: number; x?: number; y?: number });
    return parsed.findLast((message) => message.type === "reviewPoint" && message.requestId === 12) ?? null;
  });
  expect(point?.x).toBeCloseTo(0.5, 1);
  expect(point?.y).toBeCloseTo(0.5, 1);
  await page.evaluate(() => {
    const runtime = window as typeof window & { diagramAddReviewPoint(x: number, y: number): void };
    runtime.diagramAddReviewPoint(0.5, 0.5);
  });
  await expect(page.locator("[data-codewide-review-points] circle")).toHaveCount(1);
});
