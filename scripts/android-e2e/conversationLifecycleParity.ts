import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";

import type { AppServerClient } from "./appServerClient.ts";
import type { SurfaceFaultControl } from "./actionFailureParity.ts";
import { delay } from "./process.ts";
import type { ThreadRowParityFixture } from "./threadRowParity.ts";
import type { AppiumBrowser } from "./ui.ts";

const POLL_INTERVAL_MS = 100;

type Generation = "v1" | "v2";
type Layout = "phone" | "wide";
type SurfaceFaultAction =
  | { kind: "fail"; marker: string }
  | { kind: "hold" }
  | { kind: "notFound" }
  | { kind: "uncertain"; marker: string };
type SurfaceFaultState = "armed" | "intercepted" | "released" | "timedOut" | "triggered";
type SurfaceFaultTarget = "queueDispatch" | "threadOpen";
type SurfaceFaultStatus = {
  action: SurfaceFaultAction;
  faultId: string;
  state: SurfaceFaultState;
  target: SurfaceFaultTarget;
};

export type ConversationLifecycleThread = {
  id: string;
  title: string;
};

type ActivityFixture = ConversationLifecycleThread & {
  commandMarker: string;
  planMarker: string;
  reply: string;
};

type InterruptedFixture = ConversationLifecycleThread & {
  promptMarker: string;
  turnId: string;
};

export type ConversationAttachmentFixture = ConversationLifecycleThread & {
  name: string;
  userMarker: string;
};

export type ConversationLifecycleParityFixture = {
  activity: ActivityFixture;
  attachment: ConversationAttachmentFixture;
  interrupted: InterruptedFixture;
  nonce: string;
  workspace: string;
};

type CaptureRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

type CaptureConversationLifecycleInput = {
  appServer: AppServerClient;
  beginOpenThread(thread: ConversationLifecycleThread): Promise<void>;
  capture: CaptureRow;
  control: SurfaceFaultControl;
  driver: AppiumBrowser;
  fixture: ConversationLifecycleParityFixture;
  generation: Generation;
  layout: Layout;
  openThread(thread: ConversationLifecycleThread): Promise<void>;
  reconnectCurrentThread(): Promise<void>;
  returnToThreadList(): Promise<void>;
  rowFixture: ThreadRowParityFixture;
  showAttachment(name: string): Promise<void>;
  submitQueuedMessage(message: string): Promise<void>;
  timeoutMs: number;
};

type CaptureRetainedConversationInput = {
  capture: CaptureRow;
  driver: AppiumBrowser;
  expectedCompletedTurns: number;
  generation: Generation;
  layout: Layout;
  timeoutMs: number;
};

/** Creates stable real Observer turns that can be opened by both isolated UI generations. */
export async function createConversationLifecycleParityFixture(
  appServer: AppServerClient,
  workspace: string,
  nonce: string,
  timeoutMs: number,
  attachment: ConversationAttachmentFixture,
): Promise<ConversationLifecycleParityFixture> {
  const commandMarker = `LIFE_COMMAND_FAILURE_${nonce}`;
  const planMarker = `LIFE_PLAN_${nonce}`;
  const reply = `LIFE_ACTIVITY_READY_${nonce}`;
  const activity = await createFixtureThread(
    appServer,
    workspace,
    `Lifecycle parity ${nonce.slice(-8)}`,
    [
      `For the next user request, first call update_plan with exactly two steps named ${planMarker}_PREPARE and ${planMarker}_VERIFY.`,
      `Then run exactly /bin/sh -c 'printf ${commandMarker} >&2; exit 23' once with the shell tool.`,
      `After the command fails, reply exactly ${reply}.`,
    ].join(" "),
  );
  await appServer.startSubscribedTurn(
    activity.id,
    `Build the lifecycle fixture and finish with ${reply}.`,
    `lifecycle-activity-${nonce.toLowerCase()}`,
    "high",
  );
  await appServer.waitForAgentText(activity.id, reply, timeoutMs);
  const activityFixture = { ...activity, commandMarker, planMarker, reply };
  await waitForActivityFixture(appServer, activityFixture, timeoutMs);
  await appServer.request("thread/compact/start", { threadId: activity.id });
  await waitForItemType(appServer, activity.id, "contextCompaction", timeoutMs);

  const promptMarker = `LIFE_INTERRUPTED_${nonce}`;
  const interrupted = await createFixtureThread(
    appServer,
    workspace,
    `Interrupted parity ${nonce.slice(-8)}`,
    "For the next request, run exactly /bin/sh -c 'sleep 3600' with the shell tool. Wait for it to finish before replying.",
  );
  const interruptedTurnId = await startFixtureTurn(
    appServer,
    interrupted.id,
    promptMarker,
    `lifecycle-interrupted-${nonce.toLowerCase()}`,
  );
  await waitForCommandState(appServer, interrupted.id, "inProgress", timeoutMs);
  await appServer.request("turn/interrupt", {
    threadId: interrupted.id,
    turnId: interruptedTurnId,
  });
  await waitForTurnState(appServer, interrupted.id, "interrupted", timeoutMs);

  return {
    activity: activityFixture,
    attachment,
    interrupted: { ...interrupted, promptMarker, turnId: interruptedTurnId },
    nonce,
    workspace,
  };
}

/** Captures stable lifecycle/turn states against the same authoritative Observer records. */
export async function captureConversationLifecycleParity(
  input: CaptureConversationLifecycleInput,
): Promise<void> {
  await captureConversationOpening(input);
  await captureRunningCommand(input);
  await captureFailedTurn(input);
  await captureInterruptedTurn(input);
  await captureSettledActivity(input);
  await captureAttachmentInput(input);
  await captureQueueUncertain(input);
  await captureMissingThread(input);
  await captureBackendRefresh(input);
}

/** Adds the conversation-row identity for the already-disconnected retained projection state. */
export async function captureRetainedConversationParity(
  input: CaptureRetainedConversationInput,
): Promise<void> {
  await input.capture("CHAT-02", `${input.layout}-conversation-retained-projection`, async () => {
    await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    await waitForSourceText(input.driver, "connecting", input.timeoutMs);
    const source = await input.driver.getPageSource();
    if (
      input.expectedCompletedTurns > 0 &&
      occurrenceCount(source, 'text="Completed"') < input.expectedCompletedTurns
    ) {
      throw new Error("Retained conversation projection lost its completed turn footers");
    }
  });
}

async function captureRunningCommand(input: CaptureConversationLifecycleInput): Promise<void> {
  const running = input.rowFixture.running;
  await input.openThread(running);
  await waitForThreadState(input.appServer, running.id, "running", input.timeoutMs);
  await waitForCommandState(input.appServer, running.id, "inProgress", input.timeoutMs);
  const assertRunning = async (): Promise<void> => {
    await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    await waitForSourceText(input.driver, "sleep 3600", input.timeoutMs);
    await waitForSourceText(input.driver, "Running", input.timeoutMs);
    await waitForThreadState(input.appServer, running.id, "running", input.timeoutMs);
    await waitForCommandState(input.appServer, running.id, "inProgress", input.timeoutMs);
  };
  await input.capture("LIFE-06", `${input.layout}-command-activity-running`, assertRunning);
  await input.capture("TURN-02", `${input.layout}-running-turn-footer`, assertRunning);
}

async function captureConversationOpening(input: CaptureConversationLifecycleInput): Promise<void> {
  const opening = await createFixtureThread(
    input.appServer,
    input.fixture.workspace,
    `Opening parity ${input.layout} ${input.fixture.nonce.slice(-8)}`,
    "This empty thread exists only to verify the real conversation-opening boundary.",
  );
  const fault = await armSurfaceFault(input.control, "threadOpen", { kind: "hold" });
  try {
    await input.beginOpenThread(opening);
    await waitForSurfaceFault(input.control, fault.faultId, "intercepted", input.timeoutMs);
    await input.capture("CHAT-01", `${input.layout}-conversation-opening`, async () => {
      if (input.generation === "v1") {
        const loader = await input.driver.$(
          'android=new UiSelector().resourceId("conversation-navigation-loader")',
        );
        await loader.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: input.timeoutMs });
      } else {
        await waitForSourceText(input.driver, "Opening conversation…", input.timeoutMs);
      }
      const composer = await input.driver.$("~Message Codex");
      if (await composer.isDisplayed().catch(() => false)) {
        throw new Error("Conversation opening state exposed the live composer before authority");
      }
    });
  } finally {
    await releaseSurfaceFault(input.control, fault.faultId);
  }
  await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
  await input.returnToThreadList();
  await input.appServer.request("thread/archive", { threadId: opening.id });
}

async function captureBackendRefresh(input: CaptureConversationLifecycleInput): Promise<void> {
  await input.openThread(input.fixture.activity);
  const fault = await armSurfaceFault(input.control, "threadOpen", { kind: "hold" });
  try {
    await input.reconnectCurrentThread();
    await waitForSurfaceFault(input.control, fault.faultId, "intercepted", input.timeoutMs);
    await input.capture("HEADER-04", `${input.layout}-header-backend-refresh`, async () => {
      await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
      await waitForAccessibility(
        input.driver,
        "Updating conversation from server",
        input.timeoutMs,
      );
    });
  } finally {
    await releaseSurfaceFault(input.control, fault.faultId);
  }
  await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
}

async function captureMissingThread(input: CaptureConversationLifecycleInput): Promise<void> {
  const missing = await createFixtureThread(
    input.appServer,
    input.fixture.workspace,
    `Missing parity ${input.layout} ${input.fixture.nonce.slice(-8)}`,
    "This empty thread exists only to verify a real failed conversation-open response.",
  );
  await input.returnToThreadList();
  const fault = await armSurfaceFault(input.control, "threadOpen", { kind: "notFound" });
  try {
    await input.beginOpenThread(missing);
    await waitForSurfaceFault(input.control, fault.faultId, "triggered", input.timeoutMs);
    await input.capture("CHAT-05", `${input.layout}-missing-thread-error`, async () => {
      const source = await waitForPageSource(
        input.driver,
        (candidate) => /(?:not found|no longer exists|missing thread)/iu.test(candidate),
        input.timeoutMs,
        "missing-thread error",
      );
      if (source.includes("Opening conversation…")) {
        throw new Error("Missing-thread failure remained in the opening state");
      }
    });
  } finally {
    await input.returnToThreadList();
  }
  await input.appServer.request("thread/archive", { threadId: missing.id });
}

async function captureAttachmentInput(input: CaptureConversationLifecycleInput): Promise<void> {
  const attachment = input.fixture.attachment;
  await input.openThread(attachment);
  await input.showAttachment(attachment.name);
  await input.capture("LIFE-11", `${input.layout}-authoritative-attachment-input`, async () => {
    const authoritative = await input.appServer.readThread(attachment.id);
    if (!hasUserAttachment(authoritative, attachment.userMarker, attachment.name)) {
      throw new Error("App Server did not retain the authoritative attachment user input");
    }
    await waitForSourceText(input.driver, attachment.userMarker, input.timeoutMs);
    await waitForSourceText(input.driver, attachment.name, input.timeoutMs);
    const chip = await input.driver.$(
      'android=new UiSelector().descriptionStartsWith("Attachments · ")',
    );
    await chip
      .waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: input.timeoutMs })
      .catch(() => {
        throw new Error("Authoritative attachment turn did not expose its Attachments chip");
      });
    await (
      await waitForAccessibilityElement(input.driver, `Open ${attachment.name}`, input.timeoutMs)
    ).click();
    if (input.generation === "v1") {
      await waitForAccessibility(input.driver, `${attachment.name} full screen`, input.timeoutMs);
    } else {
      await waitForAccessibility(input.driver, "Close attachment", input.timeoutMs);
      await waitForSourceText(input.driver, attachment.name, input.timeoutMs);
    }
    const closeLabel = input.generation === "v1" ? "Close image" : "Close attachment";
    await (await waitForAccessibilityElement(input.driver, closeLabel, input.timeoutMs)).click();
    await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    await waitForAccessibility(input.driver, `Open ${attachment.name}`, input.timeoutMs);
  });
}

async function captureQueueUncertain(input: CaptureConversationLifecycleInput): Promise<void> {
  const suffix = `${input.fixture.nonce}-${input.generation}-${input.layout}`;
  const message = `QUEUE_UNCERTAIN_${suffix}`;
  const queue = await createFixtureThread(
    input.appServer,
    input.fixture.workspace,
    `Queue uncertain ${input.generation} ${input.layout} ${input.fixture.nonce.slice(-8)}`,
    "For the next request, run exactly /bin/sh -c 'sleep 3600' with the shell tool and wait for it before replying.",
  );
  const activeTurnId = await startFixtureTurn(
    input.appServer,
    queue.id,
    `QUEUE_ACTIVE_${suffix}`,
    `queue-active-${suffix.toLowerCase()}`,
  );
  await waitForCommandState(input.appServer, queue.id, "inProgress", input.timeoutMs);
  await input.openThread(queue);
  if (input.generation === "v2") {
    await waitForAccessibility(input.driver, "Delivery mode: Queue", input.timeoutMs);
  } else {
    await waitForAccessibility(input.driver, "Stop response", input.timeoutMs);
  }

  const faultMarker = boundedMarker("QUEUE_UNCERTAIN", suffix);
  const fault = await armSurfaceFault(input.control, "queueDispatch", {
    kind: "uncertain",
    marker: faultMarker,
  });
  await input.submitQueuedMessage(message);
  await waitForQueueTrigger(input.driver, input.generation, input.timeoutMs);
  await clickQueueTrigger(input.driver, input.generation, input.timeoutMs);
  await input.capture("TURN-01", `${input.layout}-queued-prompt-before-dispatch`, async () => {
    const source = await input.driver.getPageSource();
    if (occurrenceCount(source, `text="${message}"`) !== 1) {
      throw new Error("Queued prompt is missing or duplicated before authoritative dispatch");
    }
    await waitForSourceText(
      input.driver,
      input.generation === "v1" ? "queued" : "Queued",
      input.timeoutMs,
    );
    const authoritative = await input.appServer.readThread(queue.id);
    if (hasTurnState(authoritative, "queued") || JSON.stringify(authoritative).includes(message)) {
      throw new Error(
        "Queued Companion prompt leaked into the App Server timeline before dispatch",
      );
    }
  });
  await closeQueue(input.driver, input.generation, input.timeoutMs);
  await input.appServer.request("turn/interrupt", {
    threadId: queue.id,
    turnId: activeTurnId,
  });
  await waitForSurfaceFault(input.control, fault.faultId, "triggered", input.timeoutMs);
  await input.appServer.waitForUserText(queue.id, message, input.timeoutMs);
  await clickQueueTrigger(input.driver, input.generation, input.timeoutMs);
  await input.capture("QUEUE-07", `${input.layout}-queue-uncertain`, async () => {
    if (!JSON.stringify(await input.appServer.readThread(queue.id)).includes(message)) {
      throw new Error("Uncertain queue delivery has no authoritative App Server turn");
    }
    await waitForSourceText(input.driver, message, input.timeoutMs);
    await waitForSourceText(
      input.driver,
      input.generation === "v1" ? "uncertain" : "Delivery uncertain",
      input.timeoutMs,
    );
    await waitForSourceText(input.driver, faultMarker, input.timeoutMs);
  });
  await closeQueue(input.driver, input.generation, input.timeoutMs);
  await input.appServer.request("thread/archive", { threadId: queue.id });
}

async function captureFailedTurn(input: CaptureConversationLifecycleInput): Promise<void> {
  const failed = input.rowFixture.failed;
  await input.openThread(failed);
  await input.capture("TURN-07", `${input.layout}-failed-turn-footer`, async () => {
    await waitForThreadState(input.appServer, failed.id, "failed", input.timeoutMs);
    await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    await waitForSourceText(input.driver, "Failed", input.timeoutMs);
  });
}

async function captureInterruptedTurn(input: CaptureConversationLifecycleInput): Promise<void> {
  const interrupted = input.fixture.interrupted;
  await input.openThread(interrupted);
  await input.capture("TURN-08", `${input.layout}-interrupted-turn-footer`, async () => {
    await waitForTurnState(input.appServer, interrupted.id, "interrupted", input.timeoutMs);
    await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    await waitForSourceText(input.driver, interrupted.promptMarker, input.timeoutMs);
    await waitForSourceText(input.driver, "Stopped", input.timeoutMs);
  });
}

async function captureSettledActivity(input: CaptureConversationLifecycleInput): Promise<void> {
  const activity = input.fixture.activity;
  await input.openThread(activity);
  await waitForActivityFixture(input.appServer, activity, input.timeoutMs);
  await collapseActivityIfExpanded(input.driver);
  await input.capture("LIFE-02", `${input.layout}-reasoning-activity-collapsed`, async () => {
    await waitForExpandActivity(input.driver, input.timeoutMs);
    await assertActivityKinds(input.appServer, activity);
  });

  await clickExpandActivity(input.driver, input.timeoutMs);
  await input.capture("LIFE-03", `${input.layout}-reasoning-activity-expanded`, async () => {
    await waitForCollapseActivity(input.driver, input.timeoutMs);
    await assertActivityKinds(input.appServer, activity);
    await waitForSourceText(input.driver, "Thinking", input.timeoutMs);
  });
  await input.capture("LIFE-08", `${input.layout}-command-activity-failed`, async () => {
    await waitForCollapseActivity(input.driver, input.timeoutMs);
    await waitForSourceText(input.driver, activity.commandMarker, input.timeoutMs);
    await assertFailedCommand(input.appServer, activity);
    const source = await input.driver.getPageSource();
    if (!source.includes("Status failed") && !source.includes("Command, failed")) {
      throw new Error("Expanded lifecycle fixture does not expose its failed command state");
    }
  });
  await input.capture("LIFE-09", `${input.layout}-plan-activity`, async () => {
    await waitForCollapseActivity(input.driver, input.timeoutMs);
    await waitForSourceText(input.driver, activity.planMarker, input.timeoutMs);
    await assertPlan(input.appServer, activity);
  });
  await scrollToResource(input.driver, "pre-turn-lifecycle", input.timeoutMs);
  await input.capture("LIFE-01", `${input.layout}-pre-turn-lifecycle-row`, async () => {
    await waitForItemType(input.appServer, activity.id, "contextCompaction", input.timeoutMs);
    const lifecycle = await input.driver.$(
      'android=new UiSelector().resourceId("pre-turn-lifecycle")',
    );
    await lifecycle.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: input.timeoutMs });
    await waitForSourceText(input.driver, "Context compact", input.timeoutMs);
  });
}

async function scrollToResource(
  driver: AppiumBrowser,
  resourceId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const viewport = await driver.getWindowSize();
  while (Date.now() < deadline) {
    const target = await driver.$(`android=new UiSelector().resourceId("${resourceId}")`);
    if (await target.isDisplayed().catch(() => false)) return;
    await driver.execute("mobile: scrollGesture", {
      direction: "up",
      height: Math.max(1, viewport.height - 220),
      left: 0,
      percent: 0.85,
      top: 110,
      width: viewport.width,
    });
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out scrolling to Android resource ${resourceId}`);
}

async function createFixtureThread(
  appServer: AppServerClient,
  workspace: string,
  title: string,
  instructions: string,
): Promise<ConversationLifecycleThread> {
  const result = await appServer.request("thread/start", {
    allowProviderModelFallback: false,
    approvalPolicy: "never",
    baseInstructions: instructions,
    cwd: workspace,
    developerInstructions: instructions,
    sandbox: "danger-full-access",
  });
  const id = readThreadId(result);
  await appServer.request("thread/name/set", { name: title, threadId: id });
  await appServer.subscribeThread(id);
  return { id, title };
}

async function startFixtureTurn(
  appServer: AppServerClient,
  threadId: string,
  text: string,
  clientUserMessageId: string,
): Promise<string> {
  const result = await appServer.request("turn/start", {
    clientUserMessageId,
    input: [{ text, text_elements: [], type: "text" }],
    threadId,
  });
  if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string") {
    throw new Error("App Server returned an invalid lifecycle fixture turn/start response");
  }
  return result.turn.id;
}

async function waitForActivityFixture(
  appServer: AppServerClient,
  fixture: ActivityFixture,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(fixture.id);
    if (
      hasItemType(thread, "reasoning") &&
      hasPlanMarker(thread, fixture.planMarker) &&
      hasFailedCommandMarker(thread, fixture.commandMarker)
    ) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Observer did not materialize reasoning, plan, and failed-command activity");
}

async function assertActivityKinds(
  appServer: AppServerClient,
  fixture: ActivityFixture,
): Promise<void> {
  const thread = await appServer.readThread(fixture.id);
  if (!hasItemType(thread, "reasoning")) {
    throw new Error("Authoritative lifecycle fixture has no reasoning item");
  }
}

async function assertFailedCommand(
  appServer: AppServerClient,
  fixture: ActivityFixture,
): Promise<void> {
  if (!hasFailedCommandMarker(await appServer.readThread(fixture.id), fixture.commandMarker)) {
    throw new Error("Authoritative lifecycle fixture has no failed command item");
  }
}

async function assertPlan(appServer: AppServerClient, fixture: ActivityFixture): Promise<void> {
  if (!hasPlanMarker(await appServer.readThread(fixture.id), fixture.planMarker)) {
    throw new Error("Authoritative lifecycle fixture has no plan item");
  }
}

async function waitForThreadState(
  appServer: AppServerClient,
  threadId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(threadId);
    if (readThreadState(thread) === expected) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for thread ${threadId} state ${expected}`);
}

async function waitForTurnState(
  appServer: AppServerClient,
  threadId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(threadId);
    if (hasTurnState(thread, expected)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for a ${expected} turn in ${threadId}`);
}

async function waitForCommandState(
  appServer: AppServerClient,
  threadId: string,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(threadId);
    if (hasCommandState(thread, expected)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for a ${expected} command in ${threadId}`);
}

async function waitForItemType(
  appServer: AppServerClient,
  threadId: string,
  itemType: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(threadId);
    if (hasItemType(thread, itemType)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for a ${itemType} item in ${threadId}`);
}

async function collapseActivityIfExpanded(driver: AppiumBrowser): Promise<void> {
  const collapse = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Collapse activity ")',
  );
  if (await collapse.isDisplayed().catch(() => false)) {
    await collapse.click();
    await delay(150);
  }
}

async function clickExpandActivity(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const expand = await waitForExpandActivity(driver, timeoutMs);
  await expand.click();
  await waitForCollapseActivity(driver, timeoutMs);
}

async function waitForExpandActivity(driver: AppiumBrowser, timeoutMs: number) {
  const expand = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Expand activity ")',
  );
  await expand.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: timeoutMs });
  return expand;
}

async function waitForCollapseActivity(driver: AppiumBrowser, timeoutMs: number) {
  const collapse = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Collapse activity ")',
  );
  await collapse.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: timeoutMs });
  return collapse;
}

async function waitForAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: timeoutMs });
}

async function waitForSourceText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await driver.getPageSource()).includes(text)) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for exact UI source text ${text}`);
}

async function waitForQueueTrigger(
  driver: AppiumBrowser,
  generation: Generation,
  timeoutMs: number,
) {
  const selector =
    generation === "v1"
      ? 'android=new UiSelector().descriptionStartsWith("Open queue, ")'
      : 'android=new UiSelector().descriptionStartsWith("Open queued prompts, ")';
  const trigger = await driver.$(selector);
  await trigger.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: timeoutMs });
  return trigger;
}

async function clickQueueTrigger(
  driver: AppiumBrowser,
  generation: Generation,
  timeoutMs: number,
): Promise<void> {
  await (await waitForQueueTrigger(driver, generation, timeoutMs)).click();
  await waitForAccessibility(
    driver,
    generation === "v1" ? "Close queue" : "Close queued prompts",
    timeoutMs,
  );
}

async function closeQueue(
  driver: AppiumBrowser,
  generation: Generation,
  timeoutMs: number,
): Promise<void> {
  const label = generation === "v1" ? "Close queue" : "Close queued prompts";
  await waitForAccessibility(driver, label, timeoutMs);
  await (await driver.$(`~${label}`)).click();
  const close = await driver.$(`~${label}`);
  await close.waitForDisplayed({
    interval: POLL_INTERVAL_MS,
    reverse: true,
    timeout: timeoutMs,
  });
}

function readThreadId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("App Server returned an invalid lifecycle fixture thread/start response");
  }
  return value.thread.id;
}

function readThreadState(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.status) || typeof value.status.type !== "string") {
    return null;
  }
  if (value.status.type === "systemError") return "failed";
  if (value.status.type !== "active") return "idle";
  if (!Array.isArray(value.status.activeFlags)) return null;
  if (value.status.activeFlags.includes("waitingOnApproval")) return "waitingForApproval";
  if (value.status.activeFlags.includes("waitingOnUserInput")) return "waitingForInput";
  return "running";
}

function hasTurnState(value: unknown, expected: string): boolean {
  return readTurns(value).some((turn) => turn.status === expected);
}

function hasCommandState(value: unknown, expected: string): boolean {
  return readTurns(value).some((turn) =>
    readItems(turn).some((item) => item.type === "commandExecution" && item.status === expected),
  );
}

function hasItemType(value: unknown, expected: string): boolean {
  return readTurns(value).some((turn) => readItems(turn).some((item) => item.type === expected));
}

function hasPlanMarker(value: unknown, marker: string): boolean {
  return readTurns(value).some((turn) =>
    readItems(turn).some(
      (item) =>
        (item.type === "plan" || item.type === "turnPlan") && JSON.stringify(item).includes(marker),
    ),
  );
}

function hasFailedCommandMarker(value: unknown, marker: string): boolean {
  return readTurns(value).some((turn) =>
    readItems(turn).some(
      (item) =>
        item.type === "commandExecution" &&
        item.status === "failed" &&
        JSON.stringify(item).includes(marker),
    ),
  );
}

function hasUserAttachment(value: unknown, marker: string, name: string): boolean {
  return readTurns(value).some((turn) =>
    readItems(turn).some(
      (item) =>
        item.type === "userMessage" &&
        JSON.stringify(item).includes(marker) &&
        JSON.stringify(item).includes(name),
    ),
  );
}

function readTurns(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.turns)) return [];
  return value.turns.filter(isRecord);
}

function readItems(turn: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

async function waitForAccessibilityElement(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
) {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: POLL_INTERVAL_MS, timeout: timeoutMs });
  return element;
}

async function armSurfaceFault(
  control: SurfaceFaultControl,
  target: SurfaceFaultTarget,
  action: SurfaceFaultAction,
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(control, "POST", "/internal/e2e/v2-surface-fault", {
    action,
    target,
  });
}

async function waitForSurfaceFault(
  control: SurfaceFaultControl,
  faultId: string,
  expected: SurfaceFaultState,
  timeoutMs: number,
): Promise<SurfaceFaultStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await surfaceFaultRequest(
      control,
      "GET",
      `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
    );
    if (status.state === expected) return status;
    if (status.state === "timedOut") throw new Error(`Surface fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for surface fault ${faultId} state ${expected}`);
}

async function releaseSurfaceFault(
  control: SurfaceFaultControl,
  faultId: string,
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(
    control,
    "POST",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}/release`,
  );
}

async function surfaceFaultRequest(
  control: SurfaceFaultControl,
  method: "GET" | "POST",
  requestPath: string,
  body?: object,
): Promise<SurfaceFaultStatus> {
  const token = (await readFile(control.tokenFile, "utf8")).trim();
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = httpRequest(
      {
        headers: {
          authorization: `Bearer ${token}`,
          ...(encoded === null
            ? {}
            : {
                "content-length": String(encoded.length),
                "content-type": "application/json",
              }),
        },
        method,
        path: requestPath,
        socketPath: control.endpoint,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `Companion thread-open fault returned ${response.statusCode ?? "unknown"}: ${responseBody}`,
              ),
            );
            return;
          }
          try {
            resolve(parseSurfaceFaultStatus(JSON.parse(responseBody)));
          } catch (cause) {
            reject(cause);
          }
        });
      },
    );
    request.once("error", reject);
    request.end(encoded ?? undefined);
  });
}

function parseSurfaceFaultStatus(value: unknown): SurfaceFaultStatus {
  if (
    !isRecord(value) ||
    typeof value.faultId !== "string" ||
    !isSurfaceFaultTarget(value.target) ||
    !isSurfaceFaultState(value.state) ||
    !isSurfaceFaultAction(value.action)
  ) {
    throw new Error("Companion returned an invalid thread-open fault status");
  }
  return {
    action: value.action,
    faultId: value.faultId,
    state: value.state,
    target: value.target,
  };
}

async function waitForPageSource(
  driver: AppiumBrowser,
  predicate: (source: string) => boolean,
  timeoutMs: number,
  label: string,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await driver.getPageSource();
    if (predicate(source)) return source;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function boundedMarker(prefix: string, value: string): string {
  const suffix = value.replaceAll(/[^A-Za-z0-9]/gu, "").slice(-48);
  return `${prefix}_${suffix}`.slice(0, 96);
}

function isSurfaceFaultState(value: unknown): value is SurfaceFaultState {
  return (
    value === "armed" ||
    value === "intercepted" ||
    value === "released" ||
    value === "timedOut" ||
    value === "triggered"
  );
}

function isSurfaceFaultAction(value: unknown): value is SurfaceFaultAction {
  if (!isRecord(value)) return false;
  if (value.kind === "hold" || value.kind === "notFound") return true;
  return (value.kind === "fail" || value.kind === "uncertain") && typeof value.marker === "string";
}

function isSurfaceFaultTarget(value: unknown): value is SurfaceFaultTarget {
  return value === "queueDispatch" || value === "threadOpen";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
