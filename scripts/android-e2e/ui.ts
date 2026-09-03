import { writeFile } from "node:fs/promises";
import path from "node:path";

import type { remote } from "webdriverio";

import { delay } from "./process.ts";
import { validateRecordedVideo } from "./videoValidation.ts";

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

  const waitForAnyThreadRow = async (driver: AppiumBrowser): Promise<void> => {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of [
        'android=new UiSelector().resourceId("thread-time")',
        'android=new UiSelector().descriptionStartsWith("Open thread ")',
      ]) {
        const element = await driver.$(selector);
        if (await element.isDisplayed().catch(() => false)) return;
      }
      await delay(250);
    }
    throw new Error("No displayed thread row");
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
    const selector = `android=new UiSelector().descriptionStartsWith("Open thread ").descriptionContains("${escapeUiSelector(threadId)}")`;
    const visibleCandidate = await driver.$(selector);
    if (await visibleCandidate.isDisplayed().catch(() => false)) {
      await visibleCandidate.click();
      return true;
    }
    const search = await driver.$("~Search threads");
    if (!(await search.isDisplayed().catch(() => false))) return false;
    await search.setValue(threadId);
    const filteredCandidate = await driver.$(selector);
    const found = await filteredCandidate
      .waitForDisplayed({ timeout: Math.min(5_000, input.timeoutMs), interval: 250 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      await filteredCandidate.click();
      return true;
    }
    await search.clearValue();
    return false;
  };

  const clickAccessibility = async (driver: AppiumBrowser, label: string): Promise<void> => {
    const element = await waitForAccessibility(driver, label);
    await element.click();
  };

  const clickVisibleText = async (driver: AppiumBrowser, text: string): Promise<void> => {
    const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
    await element.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
    await element.click();
  };

  const scrollAccessibilityIntoView = async (
    driver: AppiumBrowser,
    label: string,
  ): Promise<void> => {
    const target = await driver.$(`~${label}`);
    if (await target.isDisplayed().catch(() => false)) return;
    const sheet = await driver.$('//*[@pane-title="Bottom Sheet"]');
    await sheet.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
    const sheetTop = await sheet.getLocation("y");
    const candidates = await driver.$$(
      'android=new UiSelector().className("android.widget.ScrollView")',
    );
    for (const candidate of candidates) {
      if (!(await candidate.isDisplayed().catch(() => false))) continue;
      if ((await candidate.getLocation("y")) < sheetTop) continue;
      const [height, width, x, y] = await Promise.all([
        candidate.getSize("height"),
        candidate.getSize("width"),
        candidate.getLocation("x"),
        candidate.getLocation("y"),
      ]);
      const centerX = x + Math.floor(width / 2);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await driver
          .action("pointer", { parameters: { pointerType: "touch" } })
          .move({ duration: 0, x: centerX, y: y + Math.floor(height * 0.82) })
          .down({ button: 0 })
          .pause(100)
          .move({ duration: 550, x: centerX, y: y + Math.floor(height * 0.18) })
          .up({ button: 0 })
          .perform();
        if (await target.isDisplayed().catch(() => false)) return;
        await delay(150);
      }
    }
    await target.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
  };

  const waitForApplicationReady = async (driver: AppiumBrowser): Promise<void> => {
    const deadline = Date.now() + input.timeoutMs * 2;
    while (Date.now() < deadline) {
      const shellLabels = [
        "Open manual server setup",
        "Scan pairing QR",
        "New thread",
        "Choose server",
      ];
      const source = await driver.getPageSource();
      if (shellLabels.some((label) => source.includes(`content-desc="${label}"`))) return;
      if (source.includes('text="Continue"')) {
        const continueButton = await driver.$('android=new UiSelector().text("Continue")');
        await continueButton.click();
        await delay(500);
        continue;
      }
      if (source.includes('content-desc="Close"')) {
        const closeButton = await driver.$("~Close");
        await closeButton.click();
        await delay(500);
        continue;
      }
      if (source.includes("There was a problem loading the project")) {
        throw new Error("Expo project failed to load from Metro");
      }
      const uncaughtMarker = 'text="Uncaught Error"';
      const uncaughtOffset = source.indexOf(uncaughtMarker);
      if (uncaughtOffset >= 0) {
        const detail = source
          .slice(uncaughtOffset + uncaughtMarker.length)
          .match(/text="([^"]+)"/)?.[1];
        throw new Error(
          detail === undefined
            ? "React Native application raised an uncaught error"
            : `React Native application raised an uncaught error: ${decodeXmlText(detail)}`,
        );
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
        const fileName = `${name}.mp4`;
        const filePath = path.join(input.artifactDir, fileName);
        let recordingError: Error | null = null;
        try {
          const encoded = await driver.stopRecordingScreen();
          await writeFile(filePath, Buffer.from(encoded, "base64"), { mode: 0o600 });
          input.videos.push(fileName);
          await validateRecordedVideo(filePath);
        } catch (error) {
          recordingError = error instanceof Error ? error : new Error(String(error));
        }
        if (actionError !== null && recordingError !== null) {
          throw new Error(
            `Scenario action failed: ${actionError.message}; video validation failed: ${recordingError.message}`,
            { cause: new AggregateError([actionError, recordingError]) },
          );
        }
        if (recordingError !== null) throw recordingError;
        if (actionError !== null) throw actionError;
      });
    },

    clickAccessibility,
    clickVisibleText,
    scrollAccessibilityIntoView,

    async clickLastAccessibility(driver: AppiumBrowser, label: string): Promise<void> {
      const candidates = await driver.$$(`~${label}`);
      const displayed = [];
      for (const candidate of candidates) {
        if (await candidate.isDisplayed().catch(() => false)) displayed.push(candidate);
      }
      const target = displayed.at(-1);
      if (target === undefined) throw new Error(`No displayed accessibility element ${label}`);
      await target.click();
    },

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
        const alreadyOpen = await driver.$(
          `android=new UiSelector().textContains("${escapeUiSelector(expectedText)}")`,
        );
        const openComposer = await driver.$("~Message Codex");
        if (
          (await alreadyOpen.isDisplayed().catch(() => false)) &&
          (await openComposer.isDisplayed().catch(() => false))
        )
          return;
        if (threadId !== undefined) {
          if (await openProjectedThreadById(driver, threadId)) {
            await waitForAccessibility(driver, "Message Codex");
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
      throw new Error("The authoritative thread was absent from the visible projected catalog");
    },

    async reopenLegacyThreadContaining(
      driver: AppiumBrowser,
      expectedText: string,
      compact = false,
      query = expectedText,
    ): Promise<void> {
      const search = await driver.$("~Search threads");
      if (!(await search.isDisplayed().catch(() => false))) {
        await clickAccessibility(driver, compact ? "Back to threads" : "New thread");
        await search.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
      }
      const visibleTitle = await driver.$(
        `android=new UiSelector().text("${escapeUiSelector(expectedText)}")`,
      );
      const titleVisible = await visibleTitle
        .waitForDisplayed({
          timeout: compact ? input.timeoutMs : Math.min(5_000, input.timeoutMs),
          interval: 250,
        })
        .then(() => true)
        .catch(() => false);
      if (titleVisible) {
        await visibleTitle.click();
        await waitForAccessibility(driver, "Message Codex");
        await waitForVisibleTextContaining(driver, expectedText);
        return;
      }
      await search.clearValue();
      await search.addValue(query);
      const row = await driver.$(
        `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(expectedText)}")`,
      );
      await row.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 });
      await row.click();
      await waitForAccessibility(driver, "Message Codex");
      await waitForVisibleTextContaining(driver, expectedText);
    },

    async sendComposerMessage(
      driver: AppiumBrowser,
      message: string,
      options: { beforeSend?(): Promise<void>; requireKeyboard?: boolean } = {},
    ): Promise<void> {
      const composer = await waitForAccessibility(driver, "Message Codex");
      await composer.click();
      await composer.setValue(message);
      // Keep the IME open: sending while the composer is lifted is part of the
      // Android contract, and hiding it here used to mask keyboard regressions.
      await options.beforeSend?.();
      if (options.requireKeyboard === true && !(await driver.isKeyboardShown())) {
        throw new Error("The Android IME closed before the V2 message was sent");
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await clickAccessibility(driver, "Send message");
        const deadline = Date.now() + 2_000;
        while (Date.now() < deadline) {
          const activeComposer = await driver.$("~Message Codex");
          const currentText = await activeComposer.getText().catch(() => "");
          if (currentText !== message) return;
          await delay(100);
        }
      }
      throw new Error("Send message press did not clear the composer");
    },

    waitForAccessibility,
    waitForAnyThreadRow,

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
      await composer.waitForDisplayed({ timeout: input.timeoutMs, interval: 250 }).catch(() => {
        throw new Error("Recovered conversation did not become ready after process death");
      });
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

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
