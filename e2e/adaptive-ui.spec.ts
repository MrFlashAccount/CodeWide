import { expect, test } from "@playwright/test";
import {
  createFixtureThread,
  createLargeFixtureThread,
  fixtureAgentMessage,
  fixtureTurn,
  fixtureUserMessage,
} from "../packages/fixtures/src/index.js";
import { installWorkspaceFixture } from "./workspace-fixture.js";

test.describe("adaptive CodeWide workspace", () => {
  test.beforeEach(async ({ page }) => {
    await installWorkspaceFixture(page);
  });

  test("wide layouts keep server, thread, and conversation panes visible", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "phone");

    await page.goto("/");

    await expect(page.getByLabel("All servers")).toHaveCount(0);
    await expect(page.getByLabel("Search threads")).toBeVisible();
    await expect(page.getByText("Pinned", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Release v1\.4/ }).first()).toBeVisible();
    await expect(page.getByText("All", { exact: true })).toHaveCount(0);

    await page.getByLabel("Lab, live").click();
    await expect(page.getByRole("button", { name: /Rich renderer benchmark/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Release v1\.4/ })).toHaveCount(0);

    const composer = page.getByLabel("Message Codex");
    await expect(composer).toBeVisible();
    const composerBox = await composer.boundingBox();
    const menuBox = await page.getByLabel("Composer menu").boundingBox();
    const sendBox = await page.getByLabel("Send message").boundingBox();
    expect(composerBox?.width ?? 0).toBeGreaterThan(testInfo.project.name === "fold" ? 600 : 420);
    expect(menuBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(composerBox?.x ?? 0);
    expect(sendBox?.x ?? 0).toBeGreaterThan((composerBox?.x ?? 0) + (composerBox?.width ?? 0));
    await page.screenshot({ path: `test-results/${testInfo.project.name}-workspace.png`, fullPage: true });

    await page.getByLabel("Composer menu").click();
    await expect(page.getByTestId("composer-accessory-tray")).toBeVisible();
    for (const title of ["File", "Skill", "Goal", "Runtime"]) {
      await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
    await expect(page.getByText("Controls", { exact: true })).toHaveCount(0);

    await page.screenshot({ path: `test-results/${testInfo.project.name}-controls.png`, fullPage: true });
  });


  test("completed turn footer stays below the Codex bubble", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");

    await page.goto("/");

    const turn = page.getByTestId("turn-group").filter({ hasText: "Update the changelog for v1.4" });
    const agentBubble = turn.getByTestId("codex-bubble");
    const footer = turn.getByTestId("turn-footer");
    await expect(agentBubble).toBeVisible();
    await expect(footer).toBeVisible();
    const agentBubbleBounds = await agentBubble.boundingBox();
    const footerBounds = await footer.boundingBox();
    expect(footerBounds?.y ?? 0).toBeGreaterThanOrEqual(
      (agentBubbleBounds?.y ?? 0) + (agentBubbleBounds?.height ?? 0),
    );
    expect(Math.abs((footerBounds?.x ?? 0) - (agentBubbleBounds?.x ?? 0))).toBeLessThanOrEqual(6);
    await turn.screenshot({ path: "test-results/fold-agent-footer.png" });
  });






  test("completed protocol turns without a final answer stay explicit", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");
    const source = createFixtureThread();
    const sourceTurn = fixtureTurn("completed-without-final", "Run a command", "unused");
    source.turns = [{
      ...sourceTurn,
      completedAt: 1_787_000_200,
      durationMs: 4_200,
      items: [
        fixtureUserMessage("completed-user", "Run a command"),
        {
          type: "commandExecution",
          id: "completed-command",
          command: "printf done",
          cwd: "/workspace/project",
          processId: null,
          status: "completed",
          commandActions: [],
          aggregatedOutput: "done",
          exitCode: 0,
          durationMs: 50,
        },
      ],
    }];
    await page.addInitScript((thread) => {
      (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__ = thread;
    }, source);

    await page.goto("/");
    await expect(page.getByText("Completed without final response", { exact: true })).toBeVisible();
    await expect(page.getByTestId("turn-group")).toHaveCount(1);
    await expect(page.getByTestId("user-bubble")).toHaveCount(1);
    await expect(page.getByTestId("codex-bubble")).toHaveCount(1);
    await expect(page.getByTestId("turn-activity-list")).toHaveCount(0);
  });

  test("agent bubbles hug short replies without exceeding the conversation cap", async ({ page }, testInfo) => {
    test.fixme(true, "Legend List currently reuses the injected final turn while measuring this synthetic timeline.");
    test.skip(testInfo.project.name !== "fold");
    const source = createFixtureThread();
    const sourceTurn = fixtureTurn("bubble-width", "Status?", "Done.");
    const userItem = fixtureUserMessage("bubble-user", "Status?");
    const agentItem = fixtureAgentMessage("bubble-agent", "Done.");
    const shortTurn = {
      ...sourceTurn,
      id: "short-agent-reply",
      status: "completed",
      itemsView: "full",
      items: [
        { ...userItem, id: "short-user", content: [{ type: "text", text: "Status?", text_elements: [] }] },
        { ...agentItem, id: "short-agent", text: "Done." },
      ],
    };
    const longReply = "This paragraph must determine the bubble width instead of being clipped by a narrow intrinsic container. It keeps enough readable line length, wraps only after the conversation cap, and remains fully visible without truncation.";
    const streamingTurn = {
      ...shortTurn,
      id: "streaming-agent-reply",
      status: "inProgress",
      completedAt: null,
      items: [
        { ...userItem, id: "streaming-user", content: [{ type: "text", text: "Stream status?", text_elements: [] }] },
        { ...agentItem, id: "streaming-agent", text: "Streaming." },
      ],
    };
    source.turns = [shortTurn, {
      ...shortTurn,
      id: "long-agent-reply",
      items: [
        { ...userItem, id: "long-user", content: [{ type: "text", text: "Explain the layout contract.", text_elements: [] }] },
        { ...agentItem, id: "long-agent", text: longReply },
      ],
    }, streamingTurn];
    await page.addInitScript((thread) => {
      (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__ = thread;
    }, source);

    await page.goto("/");
    const shortTurnLocator = page.getByTestId("turn-group").filter({ hasText: "Done." });
    const longTurnLocator = page.getByTestId("turn-group").filter({ hasText: longReply });
    const shortBubble = shortTurnLocator.getByTestId("codex-bubble");
    const longBubble = longTurnLocator.getByTestId("codex-bubble");
    const streamingTurnLocator = page.getByTestId("turn-group").filter({ hasText: "Streaming." });
    const streamingBubble = streamingTurnLocator.getByTestId("codex-bubble");
    await expect(shortBubble.getByText("Done.", { exact: true })).toBeVisible();
    await expect(longBubble.getByText(longReply, { exact: true })).toBeVisible();
    const shortTurnBounds = await shortTurnLocator.boundingBox();
    const shortBubbleBounds = await shortBubble.boundingBox();
    const longTurnBounds = await longTurnLocator.boundingBox();
    const longBubbleBounds = await longBubble.boundingBox();
    const streamingTurnBounds = await streamingTurnLocator.boundingBox();
    const streamingBubbleBounds = await streamingBubble.boundingBox();
    expect(shortBubbleBounds?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(240);
    expect(shortBubbleBounds?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((shortTurnBounds?.width ?? 0) * 0.94 + 1);
    expect(longBubbleBounds?.width ?? 0).toBeGreaterThan((longTurnBounds?.width ?? Number.POSITIVE_INFINITY) * 0.7);
    expect(longBubbleBounds?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((longTurnBounds?.width ?? 0) * 0.94 + 1);
    expect(streamingBubbleBounds?.width ?? 0).toBeGreaterThan((streamingTurnBounds?.width ?? Number.POSITIVE_INFINITY) * 0.85);
    expect(streamingBubbleBounds?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual((streamingTurnBounds?.width ?? 0) * 0.94 + 1);
    await page.screenshot({ path: "test-results/fold-short-agent-bubble.png", fullPage: true });
  });



  test("inline user images open in the full-screen preview", async ({ page }, testInfo) => {
    test.fixme(true, "The injected image fixture is not retained by the current virtualized test transport.");
    test.skip(testInfo.project.name !== "fold");
    const source = createFixtureThread();
    const sourceTurn = fixtureTurn("inline-user-image", "Inspect images", "Images received.");
    const userItem = fixtureUserMessage("image-user", "Inspect images");
    const agentItem = fixtureAgentMessage("image-agent", "Images received.");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
    const imageTurn = {
      ...sourceTurn,
      id: "inline-user-image",
      status: "completed",
      items: [{ ...userItem, content: [
        { type: "image", url: `data:image/png;base64,${png}` },
        { type: "image", url: `data:image/png;base64,${png}` },
      ] }, agentItem],
    };
    const fillerTurns = Array.from({ length: 32 }, (_, index) => ({
      ...sourceTurn,
      id: `preview-filler-${index}`,
      items: [
        { ...userItem, id: `preview-filler-user-${index}`, content: [{ type: "text", text: `Preview virtualization filler ${index}`, text_elements: [] }] },
        { ...agentItem, id: `preview-filler-agent-${index}`, text: `Filler response ${index}` },
      ],
    }));
    source.turns = [...fillerTurns.slice(0, 16), imageTurn, ...fillerTurns.slice(16)];
    await page.addInitScript((thread) => {
      (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__ = thread;
    }, source);

    await page.goto("/");
    await page.getByRole("button", { name: "Open Attached image 1", exact: true }).scrollIntoViewIfNeeded();
    const timelineOffsetBeforeOpen = await page.getByTestId("conversation-timeline").evaluate((root) => {
      const candidates = [root, ...root.querySelectorAll<HTMLElement>("*")];
      const scroller = candidates
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight)
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (scroller === undefined) throw new Error("Missing virtualized timeline scroller");
      return scroller.scrollTop;
    });
    expect(timelineOffsetBeforeOpen).toBeGreaterThan(20);
    await page.getByRole("button", { name: "Open Attached image 1", exact: true }).dispatchEvent("click");
    await expect(page.getByLabel("Attached image 1 full screen")).toBeVisible();
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
    const readTimelineOffset = () => page.getByTestId("conversation-timeline").evaluate((root) => {
      const candidates = [root, ...root.querySelectorAll<HTMLElement>("*")];
      const scroller = candidates
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight)
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (scroller === undefined) throw new Error("Missing virtualized timeline scroller");
      return scroller.scrollTop;
    });
    await expect.poll(readTimelineOffset).toBe(timelineOffsetBeforeOpen);
    const timelineOffsetAtOpen = await readTimelineOffset();
    let previewBounds = await page.getByLabel("Attached image 1 full screen").boundingBox();
    if (previewBounds === null) throw new Error("Missing preview bounds");
    await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height * 0.85, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByLabel("Attached image 1 full screen")).toHaveCount(0);
    await expect.poll(async () => page.getByTestId("conversation-timeline").evaluate((root) => {
      const candidates = [root, ...root.querySelectorAll<HTMLElement>("*")];
      const scroller = candidates
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight)
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (scroller === undefined) throw new Error("Missing virtualized timeline scroller");
      return scroller.scrollTop;
    })).toBe(timelineOffsetAtOpen);
    await page.getByRole("button", { name: "Open Attached image 1", exact: true }).dispatchEvent("click");
    await page.getByTestId("conversation-timeline").evaluate((root) => {
      const candidates = [root, ...root.querySelectorAll<HTMLElement>("*")];
      const scroller = candidates
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight)
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (scroller === undefined) throw new Error("Missing virtualized timeline scroller");
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(150);
    await expect(page.getByLabel("Attached image 1 full screen")).toBeVisible();
    previewBounds = await page.getByLabel("Attached image 1 full screen").boundingBox();
    if (previewBounds === null) throw new Error("Missing preview bounds after reopening");
    await page.mouse.move(previewBounds.x + previewBounds.width * 0.8, previewBounds.y + previewBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(previewBounds.x + previewBounds.width * 0.2, previewBounds.y + previewBounds.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
    previewBounds = await page.getByLabel("Attached image 2 full screen").boundingBox();
    if (previewBounds === null) throw new Error("Missing second preview bounds");
    await page.mouse.move(previewBounds.x + previewBounds.width * 0.2, previewBounds.y + previewBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(previewBounds.x + previewBounds.width * 0.8, previewBounds.y + previewBounds.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
    await page.getByLabel("Annotate image").click();
    previewBounds = await page.getByLabel("Attached image 1 full screen").boundingBox();
    if (previewBounds === null) throw new Error("Missing preview bounds");
    await page.mouse.click(previewBounds.x + previewBounds.width / 2, previewBounds.y + previewBounds.height / 2);
    await page.getByPlaceholder("What should change here?").fill("Tighten this spacing");
    await page.getByLabel("Save annotation").click();
    await page.getByLabel("Add image annotations to message").click();
    await expect(page.getByLabel("Attached image 1 full screen")).toHaveCount(0);
    await expect(page.getByPlaceholder("Message Codex…")).toHaveValue(/Image annotations[\s\S]*50\.0%, 50\.0%[\s\S]*Tighten this spacing/);
  });


  test("pairing QR scanner replaces the form modal instead of nesting behind it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");

    await page.goto("/");
    await page.getByLabel("Add server").click();
    await page.getByLabel("Scan pairing QR").click();

    await expect(page.getByText("Scan host pairing QR", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Close QR scanner")).toBeVisible();
    await expect(page.getByLabel("Server name")).toHaveCount(0);
    await page.getByLabel("Close QR scanner").click();
    await expect(page.getByLabel("Scan pairing QR")).toBeVisible();
  });

  test("thread swipe actions reveal cleanly and close after the action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");

    await page.goto("/");
    const row = page.getByTestId("selected-thread-row");
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    const startX = (box?.x ?? 0) + (box?.width ?? 0) * 0.35;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX - 230, y, { steps: 16 });
    await page.mouse.up();

    const pin = page.getByLabel(/(?:Pin|Unpin) thread/).first();
    await expect(pin).toBeVisible();
    await pin.click();
    await expect.poll(async () => (await page.getByTestId("selected-thread-row").boundingBox())?.x ?? -1).toBeCloseTo(box?.x ?? 0, 0);
  });

  test("adaptive geometry stays contiguous and all composer actions are touch safe", async ({ page }, testInfo) => {
    await page.goto("/");

    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    } else {
      const rail = await page.getByTestId("server-rail").boundingBox();
      const list = await page.getByTestId("thread-list-pane").boundingBox();
      const detail = await page.getByTestId("thread-detail-pane").boundingBox();
      expect(rail).not.toBeNull();
      expect(list).not.toBeNull();
      expect(detail).not.toBeNull();
      expect(Math.abs(((rail?.x ?? 0) + (rail?.width ?? 0)) - (list?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs(((list?.x ?? 0) + (list?.width ?? 0)) - (detail?.x ?? 0))).toBeLessThanOrEqual(1);

      const selectedRow = page.getByTestId("selected-thread-row");
      const rowBox = await selectedRow.boundingBox();
      const timeBox = await selectedRow.getByTestId("thread-time").boundingBox();
      const previewBox = await selectedRow.getByTestId("thread-preview").boundingBox();
      expect(rowBox).not.toBeNull();
      expect(timeBox).not.toBeNull();
      expect(previewBox).not.toBeNull();
      expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual((list?.x ?? 0) + (list?.width ?? 0));
      expect((timeBox?.x ?? 0) + (timeBox?.width ?? 0)).toBeLessThanOrEqual((rowBox?.x ?? 0) + (rowBox?.width ?? 0));
      expect((previewBox?.x ?? 0) + (previewBox?.width ?? 0)).toBeLessThanOrEqual((rowBox?.x ?? 0) + (rowBox?.width ?? 0));
    }

    const composer = await page.getByTestId("composer-row").boundingBox();
    const menu = await page.getByLabel("Composer menu").boundingBox();
    const inputShell = await page.getByTestId("composer-input-shell").boundingBox();
    const input = await page.getByLabel("Message Codex").boundingBox();
    const voice = await page.getByLabel("Voice input").boundingBox();
    const send = await page.getByLabel("Send message").boundingBox();
    for (const target of [menu, voice, send]) {
      expect(target?.width ?? 0).toBeGreaterThanOrEqual(48);
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(target?.y ?? -1).toBeGreaterThanOrEqual((composer?.y ?? 0) - 1);
      expect((target?.y ?? 0) + (target?.height ?? 0)).toBeLessThanOrEqual((composer?.y ?? 0) + (composer?.height ?? 0) + 1);
    }
    expect(Math.abs((inputShell?.height ?? 0) - (menu?.height ?? 0))).toBeLessThanOrEqual(1);
    expect(menu?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(input?.x ?? 0);
    expect(voice?.x ?? 0).toBeGreaterThan((input?.x ?? 0) + (input?.width ?? 0) - 100);
    expect(send?.x ?? 0).toBeGreaterThan(voice?.x ?? 0);

    await page.getByLabel("Message Codex").focus();
    const focusedComposer = await page.getByTestId("composer-row").boundingBox();
    const focusedInputShell = await page.getByTestId("composer-input-shell").boundingBox();
    expect((focusedComposer?.x ?? 0) + (focusedComposer?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    expect((focusedInputShell?.x ?? 0) + (focusedInputShell?.width ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);

    await page.getByLabel("Message Codex").fill("A multiline composer should grow with its content and stay compact until the text actually needs more room. ".repeat(12));
    await expect.poll(async () => (await page.getByTestId("composer-input-shell").boundingBox())?.height ?? 0).toBeGreaterThan(inputShell?.height ?? 48);
    expect((await page.getByTestId("composer-input-shell").boundingBox())?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(132);
    await page.getByLabel("Message Codex").fill("");
    await expect.poll(async () => (await page.getByTestId("composer-input-shell").boundingBox())?.height ?? 0).toBeCloseTo(menu?.height ?? 48, 0);
  });

  test("composer chips open model and permission sheets directly", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    }

    const modelChip = page.getByRole("button", { name: /Model and thinking:/ });
    await expect(modelChip).toBeVisible();
    await expect(page.getByLabel("Current thinking effort")).toHaveCount(0);
    await modelChip.click();
    await expect(page.getByText("Model & Thinking", { exact: true })).toBeVisible();
    await expect(page.getByText("Thinking", { exact: true })).toBeVisible();
    await page.getByLabel("Close turn controls").click();

    const permissionChip = page.getByRole("button", { name: /Permissions:/ });
    await expect(permissionChip).toBeVisible();
    await permissionChip.click();
    await expect(page.getByText("Permissions", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Server default/ })).toBeVisible();
  });

  test("phone composer actions stay inline instead of opening a root sheet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");
    await page.goto("/");
    await page.getByRole("button", { name: /Release v1\.4/ }).click();

    const composer = page.getByTestId("composer-row");
    await page.getByLabel("Composer menu").click();
    const tray = page.getByTestId("composer-accessory-tray");
    await expect(tray).toBeVisible();
    const trayBox = await tray.boundingBox();
    const composerBox = await composer.boundingBox();
    expect((trayBox?.y ?? Number.POSITIVE_INFINITY) + (trayBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? 0) + 1);
    await expect(page.getByText("Controls", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: "test-results/phone-composer-actions.png", fullPage: true });
  });

  test("long chrome labels stay bounded instead of growing the layout", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    }

    const header = page.getByTestId("conversation-header");
    const title = page.getByTestId("conversation-title");
    const subtitle = page.getByTestId("conversation-subtitle");
    await title.evaluate((element) => {
      element.textContent = "An intentionally extremely long remote thread title that must never make the conversation header grow";
    });
    await subtitle.evaluate((element) => {
      element.textContent = "an-extremely-long-worktree-directory-name-that-must-remain-on-one-line";
    });
    for (const label of [title, subtitle]) {
      expect(await label.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      expect(await label.evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden");
      expect(await label.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
    }
    expect((await header.boundingBox())?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(64);

    if (testInfo.project.name !== "phone") {
      const serverTitle = page.getByTestId("server-title");
      await serverTitle.evaluate((element) => {
        element.textContent = "An extremely long server display name that must leave room for actions";
      });
      expect(await serverTitle.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      expect(await serverTitle.evaluate((element) => getComputedStyle(element).overflow)).toBe("hidden");
      expect(await serverTitle.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");
    }
  });

  test("neutral hierarchy and rounded messaging geometry match the canonical palette", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Release v1\.4/ }).first().click();

    await expect(page.getByTestId("thread-detail-pane")).toHaveCSS("background-color", "rgb(15, 15, 15)");
    await expect(page.getByTestId("composer-input-shell")).toHaveCSS("background-color", "rgb(32, 32, 32)");
    await expect(page.getByTestId("composer-input-shell")).toHaveCSS("border-radius", "28px");
    await expect(page.getByLabel("Send message")).toHaveCSS("background-color", "rgb(230, 230, 230)");
    expect(await page.getByLabel("Message Codex").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("RobotoFlex-Regular");
    await expect(page.getByTestId("conversation-title")).toContainText("Release v1.4");
    expect(await page.getByTestId("conversation-title").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("RobotoFlex-Medium");
    await expect(page.getByTestId("conversation-header")).toHaveCSS("border-bottom-width", "0px");
    await expect(page.getByTestId("composer-row")).toHaveCSS("border-top-width", "0px");

    const bubble = page.getByTestId("user-bubble").first();
    const bubbleStyle = await bubble.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        topLeft: style.borderTopLeftRadius,
        topRight: style.borderTopRightRadius,
        bottomLeft: style.borderBottomLeftRadius,
        bottomRight: style.borderBottomRightRadius,
      };
    });
    expect(bubbleStyle).toEqual({
      background: "rgb(32, 32, 32)",
      borderWidth: "0px",
      topLeft: "18px",
      topRight: "18px",
      bottomLeft: "18px",
      bottomRight: "18px",
    });

    const codexBubble = page.getByTestId("codex-bubble").first();
    const codexStyle = await codexBubble.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderWidth: style.borderTopWidth,
        topLeft: style.borderTopLeftRadius,
        topRight: style.borderTopRightRadius,
        bottomLeft: style.borderBottomLeftRadius,
        bottomRight: style.borderBottomRightRadius,
      };
    });
    expect(codexStyle).toEqual({
      background: "rgb(24, 24, 24)",
      borderWidth: "0px",
      topLeft: "18px",
      topRight: "18px",
      bottomLeft: "18px",
      bottomRight: "18px",
    });
    await expect(page.getByTestId("turn-footer").first()).toHaveCSS("border-top-width", "0px");

    if (testInfo.project.name !== "phone") {
      await expect(page.getByTestId("server-rail")).toHaveCSS("border-right-width", "0px");
      await expect(page.getByTestId("thread-list-pane")).toHaveCSS("border-right-width", "0px");
      await expect(page.getByTestId("active-server")).toHaveCSS("background-color", "rgb(39, 39, 39)");
      await expect(page.getByTestId("active-server")).toHaveCSS("border-radius", "18px");
      await expect(page.getByTestId("active-server-marker")).toHaveCSS("background-color", "rgb(230, 230, 230)");
      await expect(page.getByTestId("selected-thread-row")).toHaveCSS("background-color", "rgb(39, 39, 39)");
      await expect(page.getByTestId("selected-thread-row")).toHaveCSS("border-radius", "18px");

      if (testInfo.project.name === "fold") {
        const turnBox = await page.getByTestId("turn-group").first().boundingBox();
        const userBox = await page.getByTestId("user-bubble").first().boundingBox();
        const agentBox = await page.getByTestId("codex-bubble").first().boundingBox();
        const detailBox = await page.getByTestId("thread-detail-pane").boundingBox();
        expect(turnBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(882);
        expect(userBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(690);
        expect(Math.abs((agentBox?.x ?? 0) - (turnBox?.x ?? 0))).toBeLessThanOrEqual(1);
        expect((turnBox?.x ?? 0) - (detailBox?.x ?? 0)).toBeGreaterThanOrEqual(48);
        expect((turnBox?.x ?? 0) - (detailBox?.x ?? 0)).toBeLessThanOrEqual(58);
      }
    } else {
      const shortTurnBox = await page.getByTestId("turn-group").first().boundingBox();
      const composerBox = await page.getByTestId("composer-row").boundingBox();
      expect((composerBox?.y ?? 0) - ((shortTurnBox?.y ?? 0) + (shortTurnBox?.height ?? 0))).toBeLessThan(32);
      const activityHeader = page.getByRole("button", { name: /Expand activity Edited files, ran commands · 6/ });
      await expect(activityHeader).toBeVisible();
      expect(await activityHeader.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }

    if (testInfo.project.name === "phone" || testInfo.project.name === "fold") {
      await page.screenshot({ path: `test-results/${testInfo.project.name}-turn-ux.png`, fullPage: true });
    }
  });

  test("thread list tracks live desktop window width", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone");
    await page.setViewportSize({ width: 1_000, height: 700 });
    await page.goto("/");

    const list = page.getByTestId("thread-list-pane");
    const narrow = await list.boundingBox();
    expect(narrow).not.toBeNull();

    await page.setViewportSize({ width: 1_400, height: 700 });
    await expect.poll(async () => (await list.boundingBox())?.width ?? 0).toBeGreaterThan((narrow?.width ?? 0) + 100);

    const rail = await page.getByTestId("server-rail").boundingBox();
    const wide = await list.boundingBox();
    const detail = await page.getByTestId("thread-detail-pane").boundingBox();
    expect(Math.abs(((rail?.x ?? 0) + (rail?.width ?? 0)) - (wide?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs(((wide?.x ?? 0) + (wide?.width ?? 0)) - (detail?.x ?? 0))).toBeLessThanOrEqual(1);
  });

  test("compact height collapses wide chrome without losing the selected thread", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone");
    await page.goto("/");
    await expect(page.getByTestId("server-rail")).toBeVisible();

    await page.setViewportSize({ width: 900, height: 420 });

    await expect(page.getByTestId("server-rail")).toHaveCount(0);
    await expect(page.getByLabel("Back to threads")).toBeVisible();
    await expect(page.getByLabel("Message Codex")).toBeVisible();
  });

  test("windowed desktop keeps the narrow conversation pane inside its bounds", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto("/");

    const detail = page.getByTestId("thread-detail-pane");
    const detailBounds = await detail.boundingBox();
    if (detailBounds === null) throw new Error("Missing narrow conversation pane");
    for (const target of [
      page.getByTestId("conversation-header"),
      page.getByTestId("conversation-timeline"),
      page.getByTestId("composer-row"),
    ]) {
      const bounds = await target.boundingBox();
      if (bounds === null) throw new Error("Missing windowed conversation element");
      expect(bounds.x).toBeGreaterThanOrEqual(detailBounds.x - 1);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(detailBounds.x + detailBounds.width + 1);
    }
    expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("phone navigates threads, sends optimistically, and returns", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");

    await page.goto("/");
    await expect(page.getByText("All threads", { exact: true })).toBeVisible();
    await expect(page.getByLabel("All servers")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Release v1\.4/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Rich renderer benchmark/ })).toBeVisible();
    await page.getByRole("button", { name: /Release v1\.4/ }).click();

    const composer = page.getByLabel("Message Codex");
    const composerBox = await composer.boundingBox();
    const menuBox = await page.getByLabel("Composer menu").boundingBox();
    expect(composerBox?.width ?? 0).toBeGreaterThan(180);
    expect(menuBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(composerBox?.x ?? 0);
    await composer.fill("Ship the verified build");
    await page.getByLabel("Send message").click();
    const optimistic = page.getByText("Ship the verified build", { exact: true });
    await expect(optimistic).toBeVisible();
    await expect(page.getByLabel("Message sending")).toBeVisible();
    const optimisticTurn = page.getByTestId("turn-group").filter({ hasText: "Ship the verified build" });
    await expect(optimisticTurn.getByTestId("codex-bubble")).toHaveCount(0);
    const optimisticBounds = await optimisticTurn.boundingBox();
    expect(optimisticBounds?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(100);
    await optimistic.scrollIntoViewIfNeeded();
    const positionedOptimisticBounds = await optimisticTurn.boundingBox();
    const composerBounds = await page.getByTestId("composer-row").boundingBox();
    const bottomGap = (composerBounds?.y ?? 0) - ((positionedOptimisticBounds?.y ?? 0) + (positionedOptimisticBounds?.height ?? 0));
    expect(bottomGap).toBeGreaterThanOrEqual(6);
    expect(bottomGap).toBeLessThan(32);
    await page.screenshot({ path: "test-results/phone-conversation.png", fullPage: true });

    await page.getByLabel("Back to threads").click();
    await expect(page.getByText("All threads", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/phone-threads.png", fullPage: true });
  });

  test("phone aggregated inbox isolates equal remote ids by server", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");

    await page.goto("/");
    await page.getByRole("button", { name: /Duplicate ID isolation/ }).click();
    await expect(page.getByText("Duplicate ID isolation", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Server Lab")).toHaveCount(0);
    await page.getByLabel("Back to threads").click();
    await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await expect(page.getByTestId("conversation-title")).toContainText("Release v1.4");
    await expect(page.getByLabel("Server Orbit")).toHaveCount(0);
  });

  test("thread filters sit beside search and mark an active filter", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page.getByText("All", { exact: true })).toHaveCount(0);
    const search = page.getByLabel("Search threads");
    const filterButton = page.getByLabel("Thread filters");
    const searchBounds = await search.boundingBox();
    const filterBounds = await filterButton.boundingBox();
    expect(filterBounds?.x ?? 0).toBeGreaterThan((searchBounds?.x ?? 0) + (searchBounds?.width ?? 0));
    await expect(page.getByTestId("thread-filter-active-dot")).toHaveCount(0);
    await filterButton.click();
    await expect(page.getByRole("menuitem", { name: "Approval needed", exact: true })).toBeVisible();
    await expect(page.getByRole("slider", { name: "BottomSheet" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Pinned", exact: true }).click();
    await expect(page.getByTestId("thread-filter-active-dot")).toBeVisible();
    if (testInfo.project.name === "phone") {
      await page.getByLabel("Choose server").click();
      await expect(page.getByText("All servers", { exact: true })).toBeVisible();
      await page.getByText("L Lab", { exact: true }).click();
      await expect(page.getByRole("button", { name: /Rich renderer benchmark/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Release v1\.4/ })).toHaveCount(0);
    }
  });

  test("draft follows its thread across warm navigation", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
      await page.getByLabel("Message Codex").fill("private per-thread draft");
      await page.getByLabel("Back to threads").click();
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    } else {
      await page.getByLabel("Lab, live").click();
      await page.getByLabel("Message Codex").fill("private per-thread draft");
      await page.getByText("Sleep/wake recovery", { exact: true }).click();
      await page.getByText("Rich renderer benchmark", { exact: true }).first().click();
    }
    await expect(page.getByLabel("Message Codex")).toHaveValue("private per-thread draft");
  });

  test("wide warm navigation isolates optimistic messages by server and thread", async ({ page }, testInfo) => {
    test.fixme(true, "Known optimistic-overlay isolation bug; keep the contract explicit until the sync layer owns it.");
    test.skip(testInfo.project.name === "phone");
    await page.goto("/");
    await page.getByLabel("Message Codex").fill("orbit-only optimistic message");
    await page.getByLabel("Send message").click();
    await expect(page.getByText("orbit-only optimistic message", { exact: true })).toBeVisible();

    await page.getByLabel("Lab, live").click();
    await expect(page.getByText("orbit-only optimistic message", { exact: true })).toHaveCount(0);

    await page.getByLabel("Orbit, live").click();
    await expect(page.getByText("orbit-only optimistic message", { exact: true })).toBeVisible();
  });


  test("large deterministic thread stays interactive across warm server navigation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");
    const largest = createLargeFixtureThread(320);
    const lastTurn = largest.turns.at(-1);
    if (lastTurn !== undefined) {
      (lastTurn as typeof lastTurn & { codewide?: unknown }).codewide = {
        plan: { explanation: "Live plan evidence", steps: [{ step: "Render metadata", status: "inProgress" }] },
        diff: "--- a/evidence.txt\n+++ b/evidence.txt\n+rendered\n",
        usage: {
          version: 1,
          status: "final",
          latestRequest: { totalTokens: 12, inputTokens: 8, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 1 },
          turn: { tokens: { totalTokens: 12, inputTokens: 8, cachedInputTokens: 4, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 1 }, cost: null },
          thread: { tokens: { totalTokens: 42, inputTokens: 30, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 12, reasoningOutputTokens: 4 }, cost: null },
          modelContextWindow: 200_000,
        },
      };
    }
    await page.addInitScript((thread) => {
      (globalThis as typeof globalThis & { __CODEWIDE_TEST_THREAD__?: unknown }).__CODEWIDE_TEST_THREAD__ = thread;
    }, largest);

    await page.goto("/");
    const timeline = page.getByTestId("conversation-timeline");
    await expect(timeline).toBeVisible();
    await expect.poll(async () => timeline.evaluate((element) => element.scrollHeight)).toBeGreaterThan(10_000);
    await page.getByLabel("Search in thread").click();
    await page.getByLabel("Search current thread").fill("Live plan evidence");
    await expect(page.getByText("Live plan evidence", { exact: true })).toBeVisible();
    await expect(page.getByText("Turn diff", { exact: true })).toBeVisible();
    await expect(page.getByLabel("8 input tokens")).toBeVisible();
    await expect(page.getByLabel("4 output tokens")).toBeVisible();
    await page.getByLabel("Close thread search").click();

    await page.getByLabel("Lab, live").click();
    await page.getByLabel("Orbit, live").click();
    await expect.poll(async () => timeline.evaluate((element) => element.scrollHeight)).toBeGreaterThan(10_000);
  });

  test("agent responses survive recycling across a long timeline scroll", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "fold");
    const largeThread = createLargeFixtureThread(320);
    largeThread.id = "release";
    largeThread.name = "🚀 Release v1.4";
    await page.addInitScript((thread) => {
      const target = globalThis as typeof globalThis & { __CODEWIDE_TEST_WORKSPACE__?: { thread?: unknown } };
      if (target.__CODEWIDE_TEST_WORKSPACE__ !== undefined) target.__CODEWIDE_TEST_WORKSPACE__.thread = thread;
    }, largeThread);

    await page.goto("/");
    const timeline = page.getByTestId("conversation-timeline");
    const scrollToRatio = async (ratio: number) => timeline.evaluate((root, nextRatio) => {
      const candidates = [root, ...root.querySelectorAll<HTMLElement>("*")];
      const scroller = candidates
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.scrollHeight > element.clientHeight)
        .sort((left, right) => right.scrollHeight - left.scrollHeight)[0];
      if (scroller === undefined) throw new Error("Missing virtualized timeline scroller");
      scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) * nextRatio);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }, ratio);
    const visibleCompletedTurnsHaveAgentText = () => timeline.evaluate((root) => {
      const viewport = root.getBoundingClientRect();
      const visibleTurns = [...root.querySelectorAll<HTMLElement>('[data-testid="turn-group"]')]
        .filter((turn) => {
          const bounds = turn.getBoundingClientRect();
          return bounds.bottom > viewport.top && bounds.top < viewport.bottom;
        });
      return visibleTurns.length > 0 && visibleTurns.every((turn) =>
        turn.querySelector('[data-testid="codex-bubble"]')?.textContent?.includes("Deterministic response"),
      );
    });

    for (const ratio of [0.72, 0.38, 0.08, 0.52, 0.94]) {
      await scrollToRatio(ratio);
      await expect.poll(visibleCompletedTurnsHaveAgentText).toBe(true);
    }
  });

  test("warm navigation restores each thread scroll anchor", async ({ page }, testInfo) => {
    test.fixme(true, "Direct DOM scrollTop mutation does not exercise Legend List's native scroll bridge.");
    await page.goto("/");
    if (testInfo.project.name === "phone") {
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    } else {
      await page.getByLabel("Lab, live").click();
    }
    const timeline = page.getByTestId("conversation-timeline");
    await expect.poll(async () => timeline.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    const savedOffset = await timeline.evaluate((element) => {
      element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight);
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return element.scrollTop;
    });
    expect(savedOffset).toBeGreaterThan(20);

    if (testInfo.project.name === "phone") {
      await page.getByLabel("Back to threads").click();
      await page.getByRole("button", { name: /Release v1\.4/ }).click();
    } else {
      await page.getByLabel("Orbit, live").click();
      await page.getByLabel("Lab, live").click();
    }
    await expect.poll(async () => await timeline.evaluate((element) => element.scrollTop)).toBeGreaterThan(savedOffset - 8);
  });

  test("first phone thread open settles directly at latest", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");
    await page.goto("/");
    await page.getByRole("button", { name: /Release v1\.4/ }).click();
    const timeline = page.getByTestId("conversation-timeline");

    await expect(timeline).toBeVisible();
    await expect(page.getByTestId("timeline-positioning-loader")).toHaveCount(0);
    await expect.poll(async () => timeline.evaluate((element) =>
      element.scrollHeight - element.clientHeight - element.scrollTop,
    )).toBeLessThanOrEqual(4);
  });

  test("creates a new thread on the selected server", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByLabel("New thread").click();
    if (testInfo.project.name === "phone") {
      await expect(page.getByText("Choose server", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Orbit/ }).last().click();
    }
    await expect(page.getByTestId("conversation-title")).toHaveText("New Chat");
    const composer = page.getByLabel("Message Codex");
    await expect(composer).toBeVisible();
    await composer.fill("Draft survives project changes");
    await page.getByLabel(/Change project, currently/).click();
    await page.getByText("Server default", { exact: true }).click();
    await expect(composer).toHaveValue("Draft survives project changes");
    await expect(page.getByTestId("conversation-title")).toHaveText("New Chat");
    if (testInfo.project.name !== "phone") await expect(page.getByTestId("selected-thread-row")).toHaveCount(0);
  });

  test("phone skips the server chooser when a server is already selected", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");
    await page.goto("/");
    await page.getByLabel("Choose server").click();
    await page.getByText("L Lab", { exact: true }).click();
    await page.getByLabel("New thread").click();
    await expect(page.getByText("Choose server", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("conversation-title")).toHaveText("New Chat");
  });

  test("renames the selected thread from its action sheet", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByLabel("Thread menu").click();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("Thread name").fill("Renamed remote thread");
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByText("Renamed remote thread", { exact: true }).last()).toBeVisible();
  });

  test("searches inside the selected thread and navigates matches", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByLabel("Search in thread").click();
    await page.getByLabel("Search current thread").fill("changelog");
    await expect(page.getByText(/1\/\d+/)).toBeVisible();
    await page.getByLabel("Next match").click();
    await page.getByLabel("Close thread search").click();
    await expect(page.getByLabel("Search current thread")).toHaveCount(0);
  });

  test("phone keeps composer controls isolated per server and thread", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");
    await page.goto("/");
    await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByRole("button", { name: /Model and thinking:/ }).click();
    await page.getByText("GPT-5.6", { exact: true }).click();
    await page.getByText("xhigh", { exact: true }).click();
    await page.getByText("pragmatic", { exact: true }).click();
    await page.getByLabel("Close turn controls").click();
    await page.waitForTimeout(150);
    await page.getByLabel("Back to threads").click();

    await page.getByRole("button", { name: /Duplicate ID isolation/ }).click();
    await page.getByRole("button", { name: /Model and thinking:/ }).click();
    await expect(page.getByRole("button", { name: "xhigh" })).toBeVisible();
    await expect(page.getByRole("button", { name: "pragmatic" })).toBeVisible();
    await page.getByLabel("Close turn controls").click();
    await page.getByLabel("Back to threads").click();

    await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByRole("button", { name: /Model and thinking:/ }).click();
    await expect(page.getByRole("button", { name: "xhigh, selected" })).toBeVisible();
    await expect(page.getByRole("button", { name: "pragmatic, selected" })).toBeVisible();
  });

  test("archived threads open from the thread-list menu and can be restored", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Thread list menu").click();
    await page.getByText("Archived threads", { exact: true }).click();
    await expect(page.getByText("Archived threads", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /Home NAS backup/ }).click();
    await page.getByLabel("Thread menu").click();
    await page.getByText("Unarchive thread", { exact: true }).click();
    await expect(page.getByRole("button", { name: /Home NAS backup/ })).toBeVisible();
  });

  test("phone long-press opens contextual thread actions", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone");
    await page.goto("/");
    await page.getByRole("button", { name: /Release v1\.4/ }).click({ delay: 500 });
    await expect(page.getByText("Mark as read", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
    await page.getByText("Mark as read", { exact: true }).click();
    await expect(page.getByText("All threads", { exact: true })).toBeVisible();
  });

  test("connection sheet supports QR and pinned WSS pairing", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByLabel("Choose server").click();
    await page.getByLabel("Add server").click();
    await expect(page.getByLabel("Scan pairing QR")).toBeVisible();
    await page.getByLabel("Open manual server setup").click();
    await expect(page.getByLabel("Server endpoint")).toBeVisible();
    await expect(page.getByLabel("TLS certificate pin")).toBeVisible();
    await expect(page.getByLabel("One-time pairing token")).toHaveAttribute("type", "password");
    if (testInfo.project.name === "phone") await page.screenshot({ path: "test-results/phone-pairing.png", fullPage: true });
  });

  test("cancelled connection forms forget pairing and replacement credentials", async ({ page }) => {
    test.fixme(true, "The settings flow was replaced; this contract needs new native-sheet selectors.");
    await page.goto("/");
    await page.getByLabel("Add server").click();
    await page.getByLabel("Open manual server setup").click();
    await page.getByLabel("Server name").fill("Discarded server");
    await page.getByLabel("Server endpoint").fill("wss://discarded.example.test/v1/sync");
    await page.getByLabel("One-time pairing token").fill("p".repeat(43));
    await page.getByLabel("TLS certificate pin").fill(`sha256/${"A".repeat(43)}=`);
    await page.getByLabel("Close server pairing").click();
    await page.getByLabel("Add server").click();
    await page.getByLabel("Open manual server setup").click();
    await expect(page.getByLabel("Server name")).toHaveValue("");
    await expect(page.getByLabel("Server endpoint")).toHaveValue("");
    await expect(page.getByLabel("One-time pairing token")).toHaveValue("");
    await expect(page.getByLabel("TLS certificate pin")).toHaveValue("");
    await page.getByLabel("Close server pairing").click();

    await page.getByLabel("Settings").click();
    await page.getByLabel("Edit Orbit").click();
    await page.getByLabel("Replacement capability for Orbit").fill("r".repeat(43));
    await page.getByLabel("Cancel editing Orbit").click();
    await page.getByLabel("Edit Orbit").click();
    await expect(page.getByLabel("Replacement capability for Orbit")).toHaveValue("");
    await page.getByLabel("Replacement capability for Orbit").fill("s".repeat(43));
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByLabel("Settings").click();
    await page.getByLabel("Edit Orbit").click();
    await expect(page.getByLabel("Replacement capability for Orbit")).toHaveValue("");
  });

  test("forks through a selected turn as an ephemeral preview", async ({ page }, testInfo) => {
    test.fixme(true, "Fork moved out of the legacy composer menu and needs a current interaction contract.");
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByLabel("Composer menu").click();
    await page.getByText("Fork", { exact: true }).click();
    await expect(page.getByText("Through selected turn", { exact: true })).toBeVisible();
    await page.getByText("Through selected turn", { exact: true }).click();
    await page.getByText("Turn 1 · Completed · 42s", { exact: true }).click();
    await page.getByLabel("Ephemeral fork").check();
    await page.getByLabel("Create fork").click();
    await expect(page.getByText(/Release v1\.4 · fork/, { exact: false }).first()).toBeVisible();
  });

  test("creates and restores a thread goal through the focused dialog", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByLabel("Composer menu").click();
    await page.getByRole("button", { name: /Goal/ }).click();
    await expect(page.getByText("Create goal", { exact: true })).toBeVisible();
    await page.getByLabel("Goal objective").fill("Finish the verified Android V1");
    await expect(page.getByText("Paused", { exact: true })).toHaveCount(0);
    await page.getByLabel("Advanced goal options").click();
    await page.getByLabel("Goal token budget").fill("50000");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Create goal", { exact: true })).toHaveCount(0);
    await page.getByLabel("Composer menu").click();
    await page.getByRole("button", { name: /Goal/ }).click();
    await expect(page.getByText(/12,480 tokens/)).toBeVisible();
    await expect(page.getByLabel("Goal objective")).toHaveValue("Finish the verified Android V1");
    await page.getByLabel("Advanced goal options").click();
    await expect(page.getByLabel("Goal token budget")).toHaveValue("50000");
  });

  test("keeps the unfinished review action out of the composer", async ({ page }, testInfo) => {
    await page.goto("/");
    if (testInfo.project.name === "phone") await page.getByRole("button", { name: /Release v1\.4/ }).click();
    await page.getByLabel("Composer menu").click();
    await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  });

  test("edits connection transport settings and requires delete confirmation", async ({ page }) => {
    test.fixme(true, "The settings flow was replaced; this contract needs new native-sheet selectors.");
    await page.goto("/");
    await page.getByLabel("Settings").click();
    await expect(page.getByLabel("Reconnect Orbit")).toBeVisible();
    await page.getByLabel("Reconnect Orbit").click();
    await page.getByLabel("Edit Orbit").click();
    await page.getByLabel("Name for Orbit").fill("Orbit Prime");
    await page.getByLabel("Endpoint for Orbit").fill("wss://new-orbit.example.test/v1/sync");
    await page.getByLabel("TLS pin for Orbit").fill(`sha256/${"A".repeat(43)}=`);
    await page.getByLabel("Save Orbit").click();
    const settings = page.getByRole("dialog");
    await expect(settings.getByText("Orbit Prime", { exact: true })).toBeVisible();
    await expect(settings.getByText("wss://new-orbit.example.test/v1/sync", { exact: true })).toBeVisible();
    await expect(settings.getByText("TLS pinned", { exact: true })).toBeVisible();
    await page.getByLabel("Delete Lab").click();
    await expect(page.getByLabel("Confirm delete Lab")).toBeVisible();
  });
});
