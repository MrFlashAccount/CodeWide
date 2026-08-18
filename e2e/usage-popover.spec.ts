import { expect, test } from "@playwright/test";
import { createFixtureThread } from "../packages/fixtures/src/index.js";
import { installWorkspaceFixture } from "./workspace-fixture.js";

test.describe("usage popover", () => {
  test.beforeEach(async ({ page }) => {
    await installWorkspaceFixture(page);
  });

  test("keeps context and account usage compact and inside the viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "tablet");
    const thread = createFixtureThread();
    const lastTurn = thread.turns.at(-1);
    if (lastTurn === undefined) throw new Error("Missing deterministic thread fixture");
    (lastTurn as typeof lastTurn & { codewide?: unknown }).codewide = {
      execution: {
        model: "gpt-5.6-sol",
        effort: "high",
        permissions: "danger-full-access",
        modelSource: "turn",
      },
      usage: {
        version: 1,
        status: "final",
        latestRequest: { inputTokens: 4_120, cachedInputTokens: 3_072, cacheWriteInputTokens: 0, outputTokens: 980, reasoningOutputTokens: 320, totalTokens: 5_100 },
        turn: { tokens: { inputTokens: 4_120, cachedInputTokens: 3_072, cacheWriteInputTokens: 0, outputTokens: 980, reasoningOutputTokens: 320, totalTokens: 5_100 }, cost: null },
        thread: {
          tokens: { inputTokens: 220_000_000, cachedInputTokens: 210_000_000, cacheWriteInputTokens: 0, outputTokens: 10_500_000, reasoningOutputTokens: 1_120, totalTokens: 230_500_000 },
          cost: {
            model: "gpt-5.6-sol", pricingVersion: "test", currency: "USD", basis: "apiEquivalent",
            price: { input: 5, cachedInput: 0.5, output: 30 },
            uncachedInputTokens: 10_000_000, cachedInputTokens: 210_000_000, cacheWriteInputTokens: 0, outputTokens: 10_500_000,
            cacheHitPercent: 95.45, uncachedInputCostUsd: 50, cachedInputCostUsd: 105, cacheWriteInputCostUsd: 0, outputCostUsd: 315, totalCostUsd: 470,
          },
        },
        modelContextWindow: 200_000,
      },
    };
    await page.addInitScript((value) => {
      (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__ = value;
    }, thread);

    await page.goto("/");
    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).first().click();
    }

    const search = page.getByLabel("Search in thread");
    const contextTrigger = page.getByLabel("Context usage and account limits");
    const [searchBounds, contextBounds] = await Promise.all([search.boundingBox(), contextTrigger.boundingBox()]);
    expect(searchBounds).not.toBeNull();
    expect(contextBounds).not.toBeNull();
    expect(contextBounds!.x).toBeGreaterThan(searchBounds!.x);
    if (await page.getByLabel("Thread menu").count() > 0) {
      const menuBounds = await page.getByLabel("Thread menu").boundingBox();
      expect(menuBounds).not.toBeNull();
      expect(menuBounds!.x).toBeGreaterThan(contextBounds!.x);
    }
    await expect(page.getByLabel("3% context used")).toBeVisible();
    await contextTrigger.click();

    const popover = page.getByTestId("usage-popover");
    await expect(popover).toBeVisible();
    await expect(popover.locator("..")).toHaveCSS("opacity", "1");
    await expect(popover.locator("..")).toHaveCSS("pointer-events", "auto");
    await expect(popover.getByTestId("usage-context-section")).toBeVisible();
    await expect(popover.getByTestId("usage-weekly-section")).toBeVisible();
    await expect(popover.getByTestId("usage-session-summary")).toBeVisible();
    await expect(popover.getByTestId("usage-session-details")).toHaveCount(0);
    await expect(popover.getByTestId("usage-session-tokens")).toHaveText("230.5M");
    await expect(popover.getByTestId("usage-session-cost")).toHaveText("≈$470.00");
    await expect(popover.getByTestId("usage-session-summary")).not.toContainText("compact");
    await expect(popover.getByTestId("usage-session-summary")).not.toContainText("—");
    await expect(popover.getByText("5.1K / 200K", { exact: true })).toBeVisible();
    await expect(popover.getByText("Unavailable", { exact: true })).toBeVisible();

    const costOverflow = await popover.getByTestId("usage-session-cost").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(costOverflow.scrollWidth).toBeLessThanOrEqual(costOverflow.clientWidth + 1);

    const bounds = await popover.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(312);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);

    await page.screenshot({ path: `test-results/${testInfo.project.name}-usage-popover.png`, fullPage: true });
    await popover.screenshot({ path: `test-results/${testInfo.project.name}-usage-popover-surface.png` });

    await popover.getByTestId("usage-session-summary").click();
    await expect(popover.getByTestId("usage-session-details")).toBeVisible();
    await expect(popover.getByTestId("usage-session-input")).toContainText("220,000,000");
    await expect(popover.getByTestId("usage-session-input")).toContainText("$155.00");
    await expect(popover.getByTestId("usage-session-output")).toContainText("10,500,000");
    await expect(popover.getByTestId("usage-session-output")).toContainText("$315.00");
    await expect(popover.getByTestId("usage-session-total")).toContainText("230,500,000");
    await expect(popover.getByTestId("usage-session-total")).toContainText("$470.00");
    await expect(popover.getByText("Compactions", { exact: true })).toBeVisible();
    await popover.screenshot({ path: `test-results/${testInfo.project.name}-usage-popover-session.png` });

    if (testInfo.project.name === "phone") {
      await page.setViewportSize({ width: viewport!.width, height: 320 });
      const resizedPopover = page.locator('[data-testid="usage-popover"]:visible').last();
      await expect(resizedPopover).toBeVisible();
      const windowedBounds = await resizedPopover.boundingBox();
      expect(windowedBounds).not.toBeNull();
      expect(windowedBounds!.height).toBeLessThanOrEqual(296);
      expect(windowedBounds!.y).toBeGreaterThanOrEqual(0);
      expect(windowedBounds!.y + windowedBounds!.height).toBeLessThanOrEqual(320);
    }
  });
});
