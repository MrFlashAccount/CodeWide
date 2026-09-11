import { expect, test, type Locator } from "@playwright/test";
import { installWorkspaceFixture } from "./workspace-fixture";

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Visible element has no layout bounds");
  return box;
}

test("conversation grid keeps titles, controls and activity within their available width", async ({ page }, testInfo) => {
  await installWorkspaceFixture(page);
  await page.goto("/");
  if (testInfo.project.name === "phone") {
    await page.getByRole("button", { name: /Release v1\.4/ }).first().click();
  }
  const header = await bounds(page.getByTestId("conversation-header"));
  const composerMenu = await bounds(page.getByLabel("Composer menu", { exact: true }));
  const title = await bounds(page.getByTestId("conversation-title"));
  expect(title.x).toBeGreaterThanOrEqual(header.x);
  expect(title.x + title.width).toBeLessThanOrEqual(header.x + header.width);

  const turn = page.getByTestId("turn-group").filter({ hasText: "Update the changelog for v1.4" }).first();
  const agent = await bounds(turn.getByTestId("codex-bubble"));
  expect(Math.abs(agent.x - composerMenu.x)).toBeLessThanOrEqual(1);
  const user = await bounds(turn.getByTestId("user-bubble"));
  expect(user.x + user.width).toBeLessThanOrEqual(header.x + header.width);

  const disclosure = turn.getByRole("button", { name: /^Expand activity/ }).first();
  await disclosure.click();
  const cards = turn.getByTestId("protocol-card-header");
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    const box = await bounds(card);
    expect(box.x).toBeGreaterThanOrEqual(agent.x);
    expect(box.x + box.width).toBeLessThanOrEqual(agent.x + agent.width + 1);
  }
  if (testInfo.project.name !== "phone") {
    const server = await bounds(page.getByTestId("server-title"));
    expect(server.y).toBeGreaterThanOrEqual(header.y);
    expect(server.y + server.height).toBeLessThanOrEqual(header.y + header.height);
  }
  await page.screenshot({ path: `test-results/${testInfo.project.name}-alignment.png`, fullPage: true });
});
