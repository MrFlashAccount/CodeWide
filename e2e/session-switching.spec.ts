import { expect, test } from "@playwright/test";
import { installWorkspaceFixture } from "./workspace-fixture.js";

test.beforeEach(async ({ page }) => {
  await installWorkspaceFixture(page);
});

test("wide session switching reuses the virtualized timeline host", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "phone");

  await page.goto("/");
  const timeline = page.getByTestId("conversation-timeline");
  await expect(timeline).toBeVisible();
  await timeline.evaluate((element) => {
    (element as HTMLElement).dataset.sessionSwitchProbe = "retained";
  });

  await page.getByLabel("Lab, live").click();
  await expect(page.getByText("Rich renderer benchmark", { exact: false }).first()).toBeVisible();
  await expect(timeline).toHaveAttribute("data-session-switch-probe", "retained");

  await page.getByLabel("Orbit, live").click();
  await expect(page.getByText("Release v1.4", { exact: false }).first()).toBeVisible();
  await expect(timeline).toHaveAttribute("data-session-switch-probe", "retained");
});
