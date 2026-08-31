import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { remote } from "webdriverio";

import { delay } from "./process.ts";

export type AppiumBrowser = Awaited<ReturnType<typeof remote>>;

type Step = <T>(name: string, action: () => Promise<T>) => Promise<T>;

/** Creates the UI-driving helpers while leaving scenario ownership in the runner. */
export function createAndroidE2eUi(input: {
  artifactDir: string;
  step: Step;
  timeoutMs: number;
  videos: string[];
}) {
  const waitForVisibleTextContaining = async (
    driver: AppiumBrowser,
    text: string,
  ): Promise<void> => {
    // The authoritative oracle proves the marker exists; Android may expose
    // harmless trailing punctuation in the rendered text node.
    const element = await driver.$(
      `android=new UiSelector().textContains("${escapeUiSelector(text)}")`,
    );
    await element.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
  };

  const waitForAccessibility = async (driver: AppiumBrowser, label: string) => {
    const element = await driver.$(`~${label}`);
    await element.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
    return element;
  };

  const openProjectedThreadMatching = async (
    driver: AppiumBrowser,
    predicate: () => Promise<boolean>,
  ): Promise<boolean> => {
    const candidates = await driver.$$(
      'android=new UiSelector().descriptionStartsWith("Open thread ")',
    );
    for (const candidate of candidates) {
      if (!(await candidate.isDisplayed().catch(() => false))) continue;
      await candidate.click();
      if (await predicate()) return true;
      await driver.back();
      await waitForAccessibility(driver, "New thread");
    }
    return false;
  };

  const openProjectedThreadById = async (
    driver: AppiumBrowser,
    threadId: string,
  ): Promise<boolean> => {
    const candidate = await driver.$(
      `android=new UiSelector().descriptionStartsWith("Open thread ").descriptionContains("${escapeUiSelector(threadId)}")`,
    );
    if (!(await candidate.isDisplayed().catch(() => false))) return false;
    await candidate.click();
    return true;
  };

  const clickAccessibility = async (driver: AppiumBrowser, label: string): Promise<void> => {
    const element = await waitForAccessibility(driver, label);
    await element.click();
  };

  const waitForApplicationReady = async (driver: AppiumBrowser): Promise<void> => {
    const deadline = Date.now() + input.timeoutMs * 2;
    while (Date.now() < deadline) {
      for (const label of [
        "Open manual server setup",
        "Scan pairing QR",
        "New thread",
        "Open Saved server 1",
      ]) {
        const appElement = await driver.$(`~${label}`);
        if (await appElement.isDisplayed().catch(() => false)) return;
      }
      const continueButton = await driver.$('android=new UiSelector().text("Continue")');
      if (await continueButton.isDisplayed().catch(() => false)) {
        await continueButton.click();
        await delay(500);
        continue;
      }
      const closeButton = await driver.$("~Close");
      if (await closeButton.isDisplayed().catch(() => false)) {
        await closeButton.click();
        await delay(500);
        continue;
      }
      const source = await driver.getPageSource();
      if (source.includes("There was a problem loading the project")) {
        throw new Error("Expo project failed to load from Metro");
      }
      await delay(250);
    }
    throw new Error("Timed out waiting for the CodeWide application shell");
  };

  return {
    async caseWithVideo(
      driver: AppiumBrowser,
      name: string,
      action: () => Promise<void>,
    ): Promise<void> {
      await input.step(name, async () => {
        await driver.startRecordingScreen({ timeLimit: "180" });
        let actionError: Error | null = null;
        try {
          await action();
        } catch (error) {
          actionError = error instanceof Error ? error : new Error(String(error));
        }
        const encoded = await driver.stopRecordingScreen();
        const fileName = `${name}.mp4`;
        await writeFile(path.join(input.artifactDir, fileName), Buffer.from(encoded, "base64"), {
          mode: 0o600,
        });
        input.videos.push(fileName);
        if (actionError !== null) throw actionError;
      });
    },

    clickAccessibility,

    async clickFirstAccessibilityExcept(
      driver: AppiumBrowser,
      excluded: ReadonlySet<string>,
    ): Promise<void> {
      const deadline = Date.now() + input.timeoutMs;
      while (Date.now() < deadline) {
        const candidates = await driver.$$("android=new UiSelector().clickable(true)");
        for (const candidate of candidates) {
          const label = await candidate.getAttribute("content-desc").catch(() => null);
          if (
            typeof label === "string" &&
            label !== "" &&
            ![...excluded].some(
              (excludedLabel) => label === excludedLabel || label.startsWith(`${excludedLabel},`),
            ) &&
            (await candidate.isDisplayed().catch(() => false))
          ) {
            await candidate.click();
            return;
          }
        }
        await delay(250);
      }
      throw new Error("No discovered V2 port was exposed as an accessible action");
    },

    async openProjectedThreadContaining(
      driver: AppiumBrowser,
      expectedText: string,
      threadId?: string,
    ): Promise<void> {
      const deadline = Date.now() + input.timeoutMs;
      while (Date.now() < deadline) {
        if (threadId !== undefined) {
          if (await openProjectedThreadById(driver, threadId)) {
            await waitForAccessibility(driver, "Attachments");
            await waitForVisibleTextContaining(driver, expectedText);
            return;
          }
          await delay(250);
          continue;
        }
        if (
          await openProjectedThreadMatching(driver, async () => {
            const expected = await driver.$(
              `android=new UiSelector().textContains("${escapeUiSelector(expectedText)}")`,
            );
            return expected
              .waitForDisplayed({
                timeout: Math.min(8_000, Math.max(1, deadline - Date.now())),
                interval: 250,
              })
              .then(() => true)
              .catch(() => false);
          })
        )
          return;
        // Projection publication can lag the authoritative App Server
        // observation. Keep polling the real catalog rather than treating an
        // empty first snapshot as proof that the command never appeared.
        await delay(250);
      }
      throw new Error("The authoritative V2 thread was absent from the visible projected catalog");
    },

    async sendComposerMessage(driver: AppiumBrowser, message: string): Promise<void> {
      const composer = await waitForAccessibility(driver, "Message Codex");
      await composer.click();
      await composer.setValue(message);
      await clickAccessibility(driver, "Send message");
    },

    waitForAccessibility,

    async waitForAccessibilityHidden(driver: AppiumBrowser, label: string): Promise<void> {
      const element = await driver.$(`~${label}`);
      await element.waitForDisplayed({ interval: 250, reverse: true, timeout: input.timeoutMs });
    },

    waitForApplicationReady,

    async waitForConnectionReady(driver: AppiumBrowser): Promise<void> {
      const deadline = Date.now() + input.timeoutMs;
      while (Date.now() < deadline) {
        const source = await driver.getPageSource();
        const unavailable =
          source.includes("Model unavailable") || source.includes("Access unavailable");
        const loading = source.includes("Loading model") || source.includes("Loading access");
        const controlsReady = source.includes("Full access") && source.includes("Message Codex");
        if (controlsReady && !unavailable && !loading) return;
        await delay(250);
      }
      throw new Error("V2 connection did not become ready after pairing");
    },

    async waitForRecoveredConversation(
      driver: AppiumBrowser,
      replies: readonly string[],
    ): Promise<void> {
      const latestReply = replies.at(-1);
      if (latestReply === undefined) {
        throw new Error("Recovery assertion requires at least one reply");
      }
      const composer = await driver.$("~Message Codex");
      if (!(await composer.isDisplayed().catch(() => false))) {
        if (
          !(await openProjectedThreadMatching(driver, async () => {
            const results = await Promise.all(
              replies.map(async (reply) => {
                const element = await driver.$(
                  `android=new UiSelector().textContains("${escapeUiSelector(reply)}")`,
                );
                return element
                  .waitForDisplayed({
                    timeout: 1_500,
                    interval: 250,
                  })
                  .then(() => true)
                  .catch(() => false);
              }),
            );
            return results.every(Boolean);
          }))
        ) {
          throw new Error("Recovered thread is absent from the authoritative catalog");
        }
      }
      await waitForAccessibility(driver, "Message Codex");
      for (const reply of replies) await waitForVisibleTextContaining(driver, reply);
    },

    async waitForTextHidden(driver: AppiumBrowser, text: string): Promise<void> {
      const element = await driver.$(
        `android=new UiSelector().textContains("${escapeUiSelector(text)}")`,
      );
      await element.waitForDisplayed({ timeout: input.timeoutMs, interval: 250, reverse: true });
    },

    waitForVisibleTextContaining,
  };
}

function escapeUiSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
