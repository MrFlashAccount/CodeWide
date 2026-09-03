import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { AppServerClient } from "./appServerClient.ts";
import { capturePendingActionParity, capturePressedActionParity } from "./actionFailureParity.ts";
import { adb, type AndroidDevice } from "./androidDevice.ts";
import { delay } from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

export type RequestDraftGeneration = "v1" | "v2";
export type RequestDraftLayout = "phone" | "wide";

type CaptureParityRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

export interface RequestDraftParityInput {
  appServer: AppServerClient;
  capture: CaptureParityRow;
  control: RequestDraftFaultControl;
  device: AndroidDevice;
  driver: AppiumBrowser;
  generation: RequestDraftGeneration;
  layout: RequestDraftLayout;
  nonce: string;
  openThread(threadId: string, title: string, marker: string): Promise<void>;
  repoRoot: string;
  restoreConversation(): Promise<void>;
  timeoutMs: number;
}

export interface RequestDraftFaultControl {
  endpoint: string;
  tokenFile: string;
}

interface ThreadFixture {
  id: string;
  marker: string;
  title: string;
}

interface PaginationFixture extends ThreadFixture {
  firstMarker: string;
  latestMarker: string;
  olderAnchorMarker: string;
}

interface SelectedCapabilityRootInput {
  id: string;
  location: {
    environmentId: string;
    path: string;
    type: "environment";
  };
}

type RequestDraftFaultTarget = "attachmentUpload" | "historyPage" | "turnSubmit";
type RequestDraftFaultAction = { kind: "hold" } | { kind: "fail"; marker: string };
type RequestDraftFaultState = "armed" | "intercepted" | "released" | "timedOut" | "triggered";

interface RequestDraftFaultStatus {
  action: RequestDraftFaultAction;
  faultId: string;
  state: RequestDraftFaultState;
  target: RequestDraftFaultTarget;
}

const PAGINATION_TURN_COUNT = 38;
let paginationBaseFixturePromise: Promise<PaginationFixture> | null = null;
const paginationFixturePromises = new Map<string, Promise<PaginationFixture>>();

/** Captures only real App Server requests; no projected request is fabricated in Android. */
export async function captureRequestParity(input: RequestDraftParityInput): Promise<void> {
  await captureSingleApproval(input);
  await captureMultipleApprovals(input);
  await captureUserInputRequest(input);
  await captureElicitationRequest(input);
  await input.restoreConversation();
}

/** Captures bounded-history states whose duration does not require a synthetic query delay. */
export async function capturePaginationParity(input: RequestDraftParityInput): Promise<void> {
  const fixture = await paginationFixture(input);
  await input.openThread(fixture.id, fixture.title, fixture.latestMarker);
  await waitForExactText(input.driver, fixture.latestMarker, input.timeoutMs);

  const olderHold = await armSurfaceFault(input.control, "historyPage", { kind: "hold" });
  try {
    await scrollUntilHistoryPageIntercepted(input, olderHold.faultId, "up");
    await input.capture("PAGE-01", `${input.layout}-loading-older-turns`, async () => {
      await assertHistoryLoading(input);
    });
  } finally {
    await releaseSurfaceFault(input.control, olderHold.faultId);
  }
  await scrollConversationToStart(input.driver, input.layout, input.timeoutMs);
  await input.capture("PAGE-02", `${input.layout}-older-page-boundary`, async () => {
    await waitForExactText(input.driver, fixture.firstMarker, input.timeoutMs);
    await assertTextHidden(input.driver, "Loading messages…");
  });

  await input.capture("PAGE-04", `${input.layout}-jump-to-latest-action`, async () => {
    await waitForAccessibilityPrefix(input.driver, "Jump to latest", input.timeoutMs);
  });

  if (input.generation === "v2") {
    const newerHold = await armSurfaceFault(input.control, "historyPage", { kind: "hold" });
    try {
      await scrollUntilHistoryPageIntercepted(input, newerHold.faultId, "down");
      await input.capture("PAGE-03", `${input.layout}-history-loading-newer-policy`, async () => {
        await waitForExactText(input.driver, fixture.olderAnchorMarker, input.timeoutMs);
        await assertHistoryLoading(input);
      });
    } finally {
      await releaseSurfaceFault(input.control, newerHold.faultId);
    }
  } else {
    // Frozen V1 reveals its already-cached SQLite range without a loading transient.
    await clickAccessibilityPrefix(input.driver, "Jump to latest", input.timeoutMs);
    await waitForExactText(input.driver, fixture.latestMarker, input.timeoutMs);
    await input.capture("PAGE-03", `${input.layout}-history-loading-newer-policy`, async () => {
      await waitForExactText(input.driver, fixture.latestMarker, input.timeoutMs);
      await assertHistoryIdle(input);
    });
  }
  await waitForExactText(input.driver, fixture.latestMarker, input.timeoutMs);
  await input.capture("PAGE-03", `${input.layout}-history-newer-page-result`, async () => {
    await waitForExactText(input.driver, fixture.latestMarker, input.timeoutMs);
    await assertHistoryIdle(input);
  });
  await scrollConversationOnce(input.driver, input.layout, "up");
  await waitForAccessibilityPrefix(input.driver, "Jump to latest", input.timeoutMs);

  const unreadMarker = `PAGENEW${fixtureMarker(input)}`;
  await input.appServer.startSubscribedTurn(
    fixture.id,
    `Reply exactly ${unreadMarker}.`,
    `e2e-page-new-${fixtureMarker(input).toLowerCase()}`,
    "low",
  );
  await input.appServer.waitForAgentText(fixture.id, unreadMarker, input.timeoutMs * 3);
  await input.capture("PAGE-05", `${input.layout}-unread-new-message-badge`, async () => {
    const jump = await waitForAccessibilityPrefix(input.driver, "Jump to latest", input.timeoutMs);
    const label = await jump.getAttribute("content-desc");
    if (typeof label !== "string" || !/new turns?$/u.test(label)) {
      throw new Error(`Jump-to-latest action has no authoritative unread count: ${String(label)}`);
    }
  });
  await clickAccessibilityPrefix(input.driver, "Jump to latest", input.timeoutMs);
  await waitForExactText(input.driver, unreadMarker, input.timeoutMs);
  await input.restoreConversation();
}

async function assertHistoryLoading(input: RequestDraftParityInput): Promise<void> {
  if (input.generation === "v2") {
    await waitForExactText(input.driver, "Loading messages…", input.timeoutMs);
    return;
  }
  const indicator = await input.driver.$(
    'android=new UiSelector().resourceId("history-loading-indicator")',
  );
  await indicator.waitForDisplayed({ interval: 100, timeout: input.timeoutMs });
}

async function assertHistoryIdle(input: RequestDraftParityInput): Promise<void> {
  if (input.generation === "v2") {
    await assertTextHidden(input.driver, "Loading messages…");
    return;
  }
  const indicator = await input.driver.$(
    'android=new UiSelector().resourceId("history-loading-indicator")',
  );
  if (await indicator.isDisplayed().catch(() => false)) {
    throw new Error("Frozen V1 still exposes its history-loading indicator after settlement");
  }
}

async function scrollUntilHistoryPageIntercepted(
  input: RequestDraftParityInput,
  faultId: string,
  direction: "down" | "up",
): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    await scrollConversationOnce(input.driver, input.layout, direction);
    const status = await readSurfaceFault(input.control, faultId);
    if (status.state === "intercepted") return;
    if (status.state !== "armed") {
      throw new Error(`History-page fault ${faultId} entered ${status.state} before interception`);
    }
    await delay(100);
  }
  throw new Error(`Scrolling ${direction} did not reach history-page fault ${faultId}`);
}

/** Captures real picker, clipboard-paste, and attachment-draft behavior on the emulator. */
export async function captureDraftParity(input: RequestDraftParityInput): Promise<void> {
  const fixtureDirectory = path.join(
    os.tmpdir(),
    `codewide-e2e-draft-${fixtureMarker(input).toLowerCase()}`,
  );
  const imageName = `draft-${fixtureMarker(input).toLowerCase()}.png`;
  const fileName = `draft-${fixtureMarker(input).toLowerCase()}.txt`;
  const pendingName = `draft-pending-${fixtureMarker(input).toLowerCase()}.txt`;
  const failedName = `draft-failed-${fixtureMarker(input).toLowerCase()}.txt`;
  const imagePath = path.join(fixtureDirectory, imageName);
  const filePath = path.join(fixtureDirectory, fileName);
  const pendingPath = path.join(fixtureDirectory, pendingName);
  const failedPath = path.join(fixtureDirectory, failedName);
  const imageDevicePath = `/sdcard/Download/${imageName}`;
  const fileDevicePath = `/sdcard/Download/${fileName}`;
  const pendingDevicePath = `/sdcard/Download/${pendingName}`;
  const failedDevicePath = `/sdcard/Download/${failedName}`;
  await mkdir(fixtureDirectory, { mode: 0o700, recursive: true });
  await Promise.all([
    writeFile(imagePath, transparentPng(), { mode: 0o600 }),
    writeFile(filePath, `DRAFTFILE${fixtureMarker(input)}\n`, { mode: 0o600 }),
    writeFile(pendingPath, `DRAFTPENDING${fixtureMarker(input)}\n`, { mode: 0o600 }),
    writeFile(failedPath, `DRAFTFAILED${fixtureMarker(input)}\n`, { mode: 0o600 }),
  ]);
  try {
    await adb(input.device, input.repoRoot, ["push", imagePath, imageDevicePath]);
    await adb(input.device, input.repoRoot, ["push", filePath, fileDevicePath]);
    await adb(input.device, input.repoRoot, ["push", pendingPath, pendingDevicePath]);
    await adb(input.device, input.repoRoot, ["push", failedPath, failedDevicePath]);

    await captureAttachmentUploadPending(input, pendingName);

    await attachDocument(input, imageName);
    await input.capture("DRAFT-02", `${input.layout}-image-attachment-card`, async () => {
      await Promise.all([
        waitForAccessibility(input.driver, "Draft attachments", input.timeoutMs),
        waitForExactText(input.driver, imageName, input.timeoutMs),
      ]);
    });

    await attachDocument(input, fileName);
    await input.capture("DRAFT-03", `${input.layout}-file-attachment-card`, async () => {
      await Promise.all([
        waitForAccessibility(input.driver, "Draft attachments", input.timeoutMs),
        waitForExactText(input.driver, fileName, input.timeoutMs),
      ]);
    });

    await removeDraftAttachment(input, fileName);
    await input.capture("DRAFT-04", `${input.layout}-remove-attachment-action`, async () => {
      await waitForTextHidden(input.driver, fileName, input.timeoutMs);
      await waitForExactText(input.driver, imageName, input.timeoutMs);
    });
    await removeDraftAttachment(input, imageName);

    await captureAttachmentUploadFailure(input, failedName);

    await captureEditableDrawing(input);

    await pasteLargeText(input);
    await input.capture("DRAFT-07", `${input.layout}-large-paste-file-attachment`, async () => {
      await waitForAccessibility(input.driver, "Draft attachments", input.timeoutMs);
      const pasted = await input.driver.$(
        'android=new UiSelector().textStartsWith("pasted-snippet-")',
      );
      await pasted.waitForDisplayed({ interval: 100, timeout: input.timeoutMs });
      const composer = await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
      if ((await composer.getText()).includes("LARGEPASTEEND")) {
        throw new Error(
          "Large clipboard paste remained in the composer instead of becoming a file",
        );
      }
    });
    await removeEveryDraftAttachment(input);
  } finally {
    await adb(input.device, input.repoRoot, [
      "shell",
      "rm",
      "-f",
      imageDevicePath,
      fileDevicePath,
      pendingDevicePath,
      failedDevicePath,
    ]).catch(() => undefined);
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
}

/** Captures a real running turn; command-submit transients need a separate deterministic hold. */
export async function captureInputParity(input: RequestDraftParityInput): Promise<void> {
  await captureSubmitPending(input);
  await captureSubmitFailure(input);
  const fixture = await createInteractiveThread(
    input,
    `Input parity ${fixtureMarker(input)}`,
    "never",
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  await submitMobilePrompt(input, "Run /bin/sh -c 'sleep 180', then reply exactly INPUTFINISHED.");
  await input.capture("INPUT-08", `${input.layout}-stop-response-action`, async () => {
    const stop = await waitForAccessibility(input.driver, "Stop response", input.timeoutMs);
    if (!(await stop.isEnabled())) throw new Error("Stop response action is disabled");
  });
  await clickAccessibility(input.driver, "Stop response", input.timeoutMs);
  await input.restoreConversation();
}

async function captureSubmitPending(input: RequestDraftParityInput): Promise<void> {
  const fixture = await createInteractiveThread(
    input,
    `Input pending ${fixtureMarker(input)}`,
    "never",
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  const fault = await armSurfaceFault(input.control, "turnSubmit", { kind: "hold" });
  try {
    await enterMobilePrompt(input, `Reply exactly INPUTPENDING${fixtureMarker(input)}.`);
    await capturePressedActionParity({
      accessibilityLabel: "Send message",
      capture: input.capture,
      driver: input.driver,
      generation: input.generation,
      layout: input.layout,
      surface: "existing-thread-send",
      timeoutMs: input.timeoutMs,
    });
    await waitForSurfaceFault(input.control, fault.faultId, "intercepted", input.timeoutMs);
    const assertPending = async (): Promise<void> => {
      const send = await waitForAccessibility(input.driver, "Send message", input.timeoutMs);
      const source = await input.driver.getPageSource();
      if ((await send.isEnabled()) || !hasPendingSignal(source)) {
        throw new Error("Existing-thread Send action did not expose its disabled busy state");
      }
    };
    await input.capture("INPUT-07", `${input.layout}-send-pending-busy`, assertPending);
    await capturePendingActionParity({
      action: "existing-thread-send",
      assertPending,
      capture: input.capture,
      driver: input.driver,
      generation: input.generation,
      layout: input.layout,
      timeoutMs: input.timeoutMs,
    });
  } finally {
    await releaseSurfaceFault(input.control, fault.faultId);
  }
}

async function captureSubmitFailure(input: RequestDraftParityInput): Promise<void> {
  const fixture = await createInteractiveThread(
    input,
    `Input failure ${fixtureMarker(input)}`,
    "never",
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  const marker = `INPUTFAIL${fixtureMarker(input)}`;
  const fault = await armSurfaceFault(input.control, "turnSubmit", { kind: "fail", marker });
  await submitMobilePrompt(input, `Reply exactly INPUTREJECTED${fixtureMarker(input)}.`);
  await waitForSurfaceFault(input.control, fault.faultId, "triggered", input.timeoutMs);
  await input.capture("INPUT-09", `${input.layout}-composer-inline-error`, async () => {
    const source = await waitForPageSource(
      input.driver,
      (candidate) => candidate.includes(marker),
      input.timeoutMs,
      "typed turn-submit rejection",
    );
    if (hasPendingSignal(source)) {
      throw new Error("Rejected turn submission remained pending");
    }
    const composer = await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
    if (!(await composer.isEnabled())) {
      throw new Error("Rejected turn submission left the composer disabled");
    }
  });
}

/** Captures an actually disabled menu item from an unscoped new-thread draft. */
export async function captureDisabledComposerMenuParity(
  input: RequestDraftParityInput,
): Promise<void> {
  await openNewThread(input);
  await clickAccessibility(input.driver, "Composer menu", input.timeoutMs);
  await input.capture("MENU-08", `${input.layout}-disabled-composer-menu-action`, async () => {
    const terminal = await waitForExactText(input.driver, "Terminal", input.timeoutMs);
    if (await terminal.isEnabled()) {
      throw new Error("Terminal is enabled before the new thread exists");
    }
  });
  await input.driver.back();
  await input.restoreConversation();
}

async function captureSingleApproval(input: RequestDraftParityInput): Promise<void> {
  const fixture = await createInteractiveThread(
    input,
    `Approval parity ${fixtureMarker(input)}`,
    "on-request",
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  await submitMobilePrompt(
    input,
    'Call exec_command exactly once with cmd "/bin/echo CODEWIDE_APPROVAL_FIXTURE", sandbox_permissions "require_escalated", and a concise justification. Do not answer without running it.',
  );
  await input.capture("REQ-01", `${input.layout}-single-approval-request`, async () => {
    await Promise.all([
      waitForAccessibility(input.driver, "Command approval", input.timeoutMs),
      waitForExactText(input.driver, "Accept once", input.timeoutMs),
      waitForExactText(input.driver, "Decline", input.timeoutMs),
    ]);
    await assertTextHidden(input.driver, "1/2");
  });
  await capturePressedActionParity({
    accessibilityLabel: "Decline",
    capture: input.capture,
    driver: input.driver,
    generation: input.generation,
    layout: input.layout,
    surface: "request-command-decline",
    timeoutMs: input.timeoutMs,
  });
}

async function captureMultipleApprovals(input: RequestDraftParityInput): Promise<void> {
  const fixture = await createInteractiveThread(
    input,
    `Approval queue ${fixtureMarker(input)}`,
    "on-request",
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  await submitMobilePrompt(
    input,
    'Issue exactly two exec_command tool calls in one assistant response, in parallel. Use cmd "/bin/echo CODEWIDE_APPROVAL_A" for one and "/bin/echo CODEWIDE_APPROVAL_B" for the other; both must use sandbox_permissions "require_escalated" and a concise justification. Do not answer before both run.',
  );
  await input.capture("REQ-02", `${input.layout}-multiple-approval-request-count`, async () => {
    await Promise.all([
      waitForAccessibility(input.driver, "Command approval", input.timeoutMs),
      waitForExactText(input.driver, "1/2", input.timeoutMs),
    ]);
  });
  await capturePressedActionParity({
    accessibilityLabel: "Decline",
    capture: input.capture,
    driver: input.driver,
    generation: input.generation,
    layout: input.layout,
    surface: "request-queued-command-decline",
    timeoutMs: input.timeoutMs,
  });
  await waitForAccessibility(input.driver, "Command approval", input.timeoutMs);
  await clickVisibleText(input.driver, "Decline", input.timeoutMs);
}

async function captureUserInputRequest(input: RequestDraftParityInput): Promise<void> {
  const fixture = await createInteractiveThread(
    input,
    `Question parity ${fixtureMarker(input)}`,
    "never",
    true,
  );
  await input.openThread(fixture.id, fixture.title, fixture.marker);
  await submitMobilePrompt(
    input,
    "Call request_user_input exactly once. Question id must be parity-choice, header must be Parity choice, question must be Choose one parity option, with Alpha and Beta options. Do not answer before the user responds.",
  );
  await input.capture("REQ-03", `${input.layout}-user-question-request`, async () => {
    await Promise.all([
      waitForAccessibility(input.driver, "Codex needs input", input.timeoutMs),
      waitForExactText(input.driver, "Parity choice", input.timeoutMs),
      waitForExactText(input.driver, "Alpha", input.timeoutMs),
      waitForExactText(input.driver, "Beta", input.timeoutMs),
    ]);
  });
  await clickVisibleText(input.driver, "Alpha", input.timeoutMs);
  await capturePressedActionParity({
    accessibilityLabel: "Submit",
    capture: input.capture,
    driver: input.driver,
    generation: input.generation,
    layout: input.layout,
    surface: "request-user-input-submit",
    timeoutMs: input.timeoutMs,
  });
}

async function captureElicitationRequest(input: RequestDraftParityInput): Promise<void> {
  const fixtureRoot = path.join(
    os.tmpdir(),
    `codewide-e2e-mcp-${fixtureMarker(input).toLowerCase()}`,
  );
  const manifestDirectory = path.join(fixtureRoot, ".codex-plugin");
  const serverPath = path.join(input.repoRoot, "scripts/android-e2e/mcpElicitationServer.mjs");
  await mkdir(manifestDirectory, { mode: 0o700, recursive: true });
  await Promise.all([
    writeFile(
      path.join(manifestDirectory, "plugin.json"),
      JSON.stringify({ name: "android-parity" }),
      { mode: 0o600 },
    ),
    writeFile(
      path.join(fixtureRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          "android-parity": {
            args: [serverPath],
            command: process.execPath,
            startup_timeout_sec: 10,
            tool_timeout_sec: 120,
          },
        },
      }),
      { mode: 0o600 },
    ),
  ]);
  try {
    const fixture = await createInteractiveThread(
      input,
      `Elicitation parity ${fixtureMarker(input)}`,
      "never",
      false,
      [
        {
          id: `android-parity@${fixtureMarker(input)}`,
          location: {
            environmentId: "local",
            path: pathToFileURL(fixtureRoot).href,
            type: "environment",
          },
        },
      ],
    );
    await input.openThread(fixture.id, fixture.title, fixture.marker);
    await submitMobilePrompt(
      input,
      "Call the request_confirmation tool from the android-parity MCP server exactly once. Do not answer before the tool completes.",
    );
    await input.capture("REQ-04", `${input.layout}-elicitation-form-request`, async () => {
      await Promise.all([
        waitForExactText(input.driver, "Confirm the Android MCP parity request", input.timeoutMs),
        waitForExactText(input.driver, "Confirmed *", input.timeoutMs),
        waitForExactText(input.driver, "Yes", input.timeoutMs),
        waitForExactText(input.driver, "No", input.timeoutMs),
        waitForExactText(input.driver, "Decline", input.timeoutMs),
        waitForExactText(input.driver, "Submit", input.timeoutMs),
      ]);
    });
    await clickVisibleText(input.driver, "Yes", input.timeoutMs);
    await capturePressedActionParity({
      accessibilityLabel: "Submit",
      capture: input.capture,
      driver: input.driver,
      generation: input.generation,
      layout: input.layout,
      surface: "request-elicitation-submit",
      timeoutMs: input.timeoutMs,
    });
    await waitForTextHidden(
      input.driver,
      "Confirm the Android MCP parity request",
      input.timeoutMs,
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

async function paginationFixture(input: RequestDraftParityInput): Promise<PaginationFixture> {
  const key = fixtureKey(input);
  const existing = paginationFixturePromises.get(key);
  if (existing !== undefined) return existing;
  const created = forkPaginationFixture(input).catch((cause: unknown) => {
    paginationFixturePromises.delete(key);
    throw cause;
  });
  paginationFixturePromises.set(key, created);
  return created;
}

async function forkPaginationFixture(input: RequestDraftParityInput): Promise<PaginationFixture> {
  paginationBaseFixturePromise ??= createPaginationBaseFixture(input).catch((cause: unknown) => {
    paginationBaseFixturePromise = null;
    throw cause;
  });
  const base = await paginationBaseFixturePromise;
  const result = await input.appServer.request("thread/fork", {
    excludeTurns: true,
    threadId: base.id,
  });
  const id = readStartedThreadId(result);
  const title = `Pagination parity ${fixtureMarker(input)}`;
  await input.appServer.request("thread/name/set", { name: title, threadId: id });
  await input.appServer.subscribeThread(id);
  return {
    firstMarker: base.firstMarker,
    id,
    latestMarker: base.latestMarker,
    marker: base.latestMarker,
    olderAnchorMarker: base.olderAnchorMarker,
    title,
  };
}

async function createPaginationBaseFixture(
  input: RequestDraftParityInput,
): Promise<PaginationFixture> {
  const title = `Pagination source ${input.nonce.slice(-12)}`;
  const id = await input.appServer.createThread(input.repoRoot, title);
  await input.appServer.subscribeThread(id);
  let firstMarker = "";
  let latestMarker = "";
  let olderAnchorMarker = "";
  for (let index = 1; index <= PAGINATION_TURN_COUNT; index += 1) {
    const marker = `PAGE${input.nonce.slice(-8)}${String(index).padStart(2, "0")}`;
    if (index === 1) firstMarker = marker;
    if (index === PAGINATION_TURN_COUNT - 2) olderAnchorMarker = marker;
    latestMarker = marker;
    await input.appServer.startSubscribedTurn(
      id,
      `Reply exactly ${marker}.`,
      `e2e-pagination-${input.nonce.slice(-8).toLowerCase()}-${String(index)}`,
      "low",
    );
    await input.appServer.waitForAgentText(id, marker, input.timeoutMs * 3);
  }
  return { firstMarker, id, latestMarker, marker: latestMarker, olderAnchorMarker, title };
}

async function createInteractiveThread(
  input: RequestDraftParityInput,
  title: string,
  approvalPolicy: "never" | "on-request",
  requestUserInput = false,
  selectedCapabilityRoots?: readonly SelectedCapabilityRootInput[],
): Promise<ThreadFixture> {
  const result = await input.appServer.request("thread/start", {
    approvalPolicy,
    approvalsReviewer: "user",
    baseInstructions:
      "You are a bounded Android end-to-end fixture. Perform exactly the requested tool call and wait for the user-facing result. Do not substitute prose for a requested tool call.",
    config: requestUserInput ? { features: { default_mode_request_user_input: true } } : {},
    cwd: input.repoRoot,
    developerInstructions:
      "This is a real UI protocol test. Call only the explicitly requested tools and do not make repository changes.",
    sandbox: "danger-full-access",
    ...(selectedCapabilityRoots === undefined
      ? {}
      : { selectedCapabilityRoots: [...selectedCapabilityRoots] }),
  });
  const id = readStartedThreadId(result);
  await input.appServer.request("thread/name/set", { name: title, threadId: id });
  return { id, marker: title, title };
}

async function attachDocument(input: RequestDraftParityInput, name: string): Promise<void> {
  await beginAttachDocument(input, name);
  await waitForExactText(input.driver, name, input.timeoutMs);
}

async function beginAttachDocument(input: RequestDraftParityInput, name: string): Promise<void> {
  await clickAccessibility(input.driver, "Composer menu", input.timeoutMs);
  await clickVisibleText(input.driver, "Attach file", input.timeoutMs);
  await chooseAndroidDocument(input.driver, name, input.timeoutMs);
}

async function captureAttachmentUploadPending(
  input: RequestDraftParityInput,
  name: string,
): Promise<void> {
  const fault = await armSurfaceFault(input.control, "attachmentUpload", { kind: "hold" });
  try {
    await beginAttachDocumentWithPressedCapture(input, name);
    await waitForSurfaceFault(input.control, fault.faultId, "intercepted", input.timeoutMs);
    const assertPending = async (): Promise<void> => {
      const source = await input.driver.getPageSource();
      if (input.generation === "v1") {
        if (
          source.includes(name) ||
          source.includes('content-desc="Draft attachments"') ||
          /(?:Uploading|busy="true")/u.test(source)
        ) {
          throw new Error(`Frozen V1 unexpectedly exposed pending attachment ${name}`);
        }
        return;
      }
      if (
        !source.includes(name) ||
        !source.includes('content-desc="Draft attachments"') ||
        !/(?:Uploading|busy="true")/u.test(source)
      ) {
        throw new Error(`Attachment ${name} did not expose its pending upload card`);
      }
    };
    await input.capture(
      "DRAFT-01",
      `${input.layout}-attachment-upload-pending-policy`,
      assertPending,
    );
    await capturePendingActionParity({
      action: "action-attachment-upload",
      assertPending,
      capture: input.capture,
      driver: input.driver,
      generation: input.generation,
      layout: input.layout,
      timeoutMs: input.timeoutMs,
    });
  } finally {
    await releaseSurfaceFault(input.control, fault.faultId);
  }
  await waitForExactText(input.driver, name, input.timeoutMs);
  await waitForPageSource(
    input.driver,
    (source) => source.includes(name) && !source.includes("Uploading"),
    input.timeoutMs,
    `attachment ${name} upload settlement`,
  );
  await input.capture("DRAFT-01", `${input.layout}-attachment-upload-result`, async () => {
    await waitForExactText(input.driver, name, input.timeoutMs);
    const actionLabel = input.generation === "v1" ? `Remove ${name}` : "Remove attachment";
    const action = await waitForAccessibility(input.driver, actionLabel, input.timeoutMs);
    if (!(await action.isEnabled())) {
      throw new Error(`Settled attachment ${name} has no enabled removal action`);
    }
    const source = await input.driver.getPageSource();
    if (source.includes("Uploading")) {
      throw new Error(`Settled attachment ${name} still exposes upload progress`);
    }
  });
  await removeDraftAttachment(input, name);
}

async function beginAttachDocumentWithPressedCapture(
  input: RequestDraftParityInput,
  name: string,
): Promise<void> {
  await clickAccessibility(input.driver, "Composer menu", input.timeoutMs);
  await capturePressedActionParity({
    accessibilityLabel: "Attach file",
    capture: input.capture,
    driver: input.driver,
    generation: input.generation,
    layout: input.layout,
    surface: "attachment-upload",
    timeoutMs: input.timeoutMs,
  });
  await chooseAndroidDocument(input.driver, name, input.timeoutMs);
}

async function captureAttachmentUploadFailure(
  input: RequestDraftParityInput,
  name: string,
): Promise<void> {
  const marker = `UPLOADFAIL${fixtureMarker(input)}`;
  const fault = await armSurfaceFault(input.control, "attachmentUpload", {
    kind: "fail",
    marker,
  });
  await beginAttachDocument(input, name);
  await waitForSurfaceFault(input.control, fault.faultId, "triggered", input.timeoutMs);
  await input.capture("DRAFT-06", `${input.layout}-failed-attachment-upload`, async () => {
    const source = await waitForPageSource(
      input.driver,
      (candidate) => candidate.includes(marker),
      input.timeoutMs,
      `failed upload ${name}`,
    );
    if (!source.includes(name) && !source.includes("Could not attach file")) {
      throw new Error(`Failed upload ${name} has no attachment-card or dialog identity`);
    }
  });
  await dismissFailedUpload(input, name);
}

async function dismissFailedUpload(input: RequestDraftParityInput, name: string): Promise<void> {
  const cancel = await input.driver.$('android=new UiSelector().text("Cancel")');
  if (await cancel.isDisplayed().catch(() => false)) {
    await cancel.click();
    return;
  }
  await removeDraftAttachment(input, name);
}

async function captureEditableDrawing(input: RequestDraftParityInput): Promise<void> {
  await clickAccessibility(input.driver, "Composer menu", input.timeoutMs);
  await clickVisibleText(input.driver, "Drawing", input.timeoutMs);
  await waitForAccessibility(input.driver, "Attach drawing", input.timeoutMs);
  await waitForAccessibilityEnabled(input.driver, "Attach drawing", input.timeoutMs);
  await clickAccessibility(input.driver, "Attach drawing", input.timeoutMs);
  await waitForAccessibility(input.driver, "Draft attachments", input.timeoutMs);
  const edit = await waitForDrawingEditAction(input);
  await edit.click();
  await Promise.all([
    waitForAccessibility(input.driver, "Save drawing", input.timeoutMs),
    waitForExactText(input.driver, "Editing attachment", input.timeoutMs),
  ]);
  await clickAccessibility(input.driver, "Close drawing", input.timeoutMs);
  await input.capture("DRAFT-05", `${input.layout}-edit-attachment-action`, async () => {
    const action = await waitForDrawingEditAction(input);
    if (!(await action.isEnabled())) throw new Error("Drawing edit action is disabled");
  });
  await removeEveryDraftAttachment(input);
}

async function chooseAndroidDocument(
  driver: AppiumBrowser,
  name: string,
  timeoutMs: number,
): Promise<void> {
  const document = await driver.$(`android=new UiSelector().text("${escapeUiSelector(name)}")`);
  await document.waitForDisplayed({ interval: 250, timeout: timeoutMs });
  await document.click();
}

async function removeDraftAttachment(input: RequestDraftParityInput, name: string): Promise<void> {
  if (input.generation === "v1") {
    await clickAccessibility(input.driver, `Remove ${name}`, input.timeoutMs);
    return;
  }
  const cardText = await waitForExactText(input.driver, name, input.timeoutMs);
  await clickNearestVisibleAction(
    input.driver,
    await cardText.getLocation("y"),
    "Remove attachment",
  );
}

async function removeEveryDraftAttachment(input: RequestDraftParityInput): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tray = await input.driver.$("~Draft attachments");
    if (!(await tray.isDisplayed().catch(() => false))) return;
    const selector =
      input.generation === "v1"
        ? 'android=new UiSelector().descriptionStartsWith("Remove ")'
        : "~Remove attachment";
    const actions = await tray.$$(selector);
    const visible = [];
    for (const action of actions) {
      if (await action.isDisplayed().catch(() => false)) visible.push(action);
    }
    const first = visible[0];
    if (first === undefined) throw new Error("Draft attachment tray has no removal action");
    await first.click();
    await delay(100);
  }
  throw new Error("Draft attachment tray did not become empty after eight removals");
}

async function pasteLargeText(input: RequestDraftParityInput): Promise<void> {
  const largeText = `${"LARGEPASTE".repeat(2_000)}LARGEPASTEEND`;
  await input.driver.execute("mobile: setClipboard", {
    content: Buffer.from(largeText).toString("base64"),
    contentType: "plaintext",
  });
  const composer = await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
  await composer.click();
  await adb(input.device, input.repoRoot, ["shell", "input", "keyevent", "279"]);
}

async function submitMobilePrompt(input: RequestDraftParityInput, prompt: string): Promise<void> {
  await enterMobilePrompt(input, prompt);
  await clickAccessibility(input.driver, "Send message", input.timeoutMs);
}

async function enterMobilePrompt(input: RequestDraftParityInput, prompt: string): Promise<void> {
  const composer = await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
  await composer.setValue(prompt);
  await waitForAccessibility(input.driver, "Send message", input.timeoutMs);
  await waitForAccessibilityEnabled(input.driver, "Send message", input.timeoutMs);
}

async function waitForDrawingEditAction(input: RequestDraftParityInput) {
  const selector =
    input.generation === "v1"
      ? 'android=new UiSelector().descriptionStartsWith("Edit ")'
      : "~Edit attachment";
  const action = await input.driver.$(selector);
  await action.waitForDisplayed({ interval: 100, timeout: input.timeoutMs });
  return action;
}

async function clickNearestVisibleAction(
  driver: AppiumBrowser,
  anchorY: number,
  accessibilityLabel: string,
): Promise<void> {
  const actions = await driver.$$(`~${accessibilityLabel}`);
  let nearest: { distance: number; element: WebdriverIO.Element } | undefined;
  for (const action of actions) {
    if (!(await action.isDisplayed().catch(() => false))) continue;
    const distance = Math.abs((await action.getLocation("y")) - anchorY);
    if (nearest === undefined || distance < nearest.distance)
      nearest = { distance, element: action };
  }
  if (nearest === undefined) {
    throw new Error(`No visible ${accessibilityLabel} action exists near the attachment`);
  }
  await nearest.element.click();
}

async function waitForAccessibilityEnabled(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = await driver.$(`~${label}`);
    if (await element.isEnabled().catch(() => false)) return;
    await delay(100);
  }
  throw new Error(`${label} did not become enabled`);
}

async function openNewThread(input: RequestDraftParityInput): Promise<void> {
  const newThread = await input.driver.$("~New thread");
  if (await newThread.isDisplayed().catch(() => false)) await newThread.click();
  else {
    const back = await input.driver.$("~Back to threads");
    if (await back.isDisplayed().catch(() => false)) await back.click();
    await clickAccessibility(input.driver, "New thread", input.timeoutMs);
  }
  await waitForExactText(input.driver, "What would you like to work on?", input.timeoutMs);
}

async function scrollConversationToStart(
  driver: AppiumBrowser,
  layout: RequestDraftLayout,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs * 2;
  while (Date.now() < deadline) {
    const canScroll = await scrollConversationOnce(driver, layout, "up");
    await delay(100);
    if (canScroll !== true) return;
  }
  throw new Error("Conversation did not reach its oldest bounded page");
}

async function scrollConversationOnce(
  driver: AppiumBrowser,
  layout: RequestDraftLayout,
  direction: "down" | "up",
): Promise<unknown> {
  const { height, width } = await driver.getWindowSize();
  const left = layout === "phone" ? 8 : Math.floor(width * 0.42);
  return driver.execute("mobile: scrollGesture", {
    direction,
    height: Math.floor(height * 0.7),
    left,
    percent: 0.92,
    top: Math.floor(height * 0.14),
    width: width - left - 8,
  });
}

async function waitForAccessibility(driver: AppiumBrowser, label: string, timeoutMs: number) {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  return element;
}

async function waitForAccessibilityPrefix(
  driver: AppiumBrowser,
  prefix: string,
  timeoutMs: number,
) {
  const element = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(prefix)}")`,
  );
  await element.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  return element;
}

async function clickAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibility(driver, label, timeoutMs);
  await element.click();
}

async function clickAccessibilityPrefix(
  driver: AppiumBrowser,
  prefix: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibilityPrefix(driver, prefix, timeoutMs);
  await element.click();
}

async function waitForExactText(driver: AppiumBrowser, text: string, timeoutMs: number) {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  await element.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  return element;
}

async function clickVisibleText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForExactText(driver, text, timeoutMs);
  await element.click();
}

async function assertTextHidden(driver: AppiumBrowser, text: string): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  if (await element.isDisplayed().catch(() => false)) {
    throw new Error(`Unexpected visible text ${text}`);
  }
}

async function waitForTextHidden(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  await element.waitForDisplayed({ interval: 100, reverse: true, timeout: timeoutMs });
}

function readStartedThreadId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("App Server returned an invalid thread creation response");
  }
  return value.thread.id;
}

function fixtureMarker(input: RequestDraftParityInput): string {
  return `${input.layout.toUpperCase()}${input.nonce.slice(-8)}`;
}

function fixtureKey(input: RequestDraftParityInput): string {
  return `${input.generation}:${fixtureMarker(input)}`;
}

function transparentPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

function escapeUiSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPendingSignal(source: string): boolean {
  return (
    source.includes('busy="true"') ||
    /(?:Sending|Creating|Starting|Uploading|Loading|waiting for the server|Send)(?:…|\.\.\.)/u.test(
      source,
    )
  );
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

async function armSurfaceFault(
  control: RequestDraftFaultControl,
  target: RequestDraftFaultTarget,
  action: RequestDraftFaultAction,
): Promise<RequestDraftFaultStatus> {
  return surfaceFaultRequest(control, "POST", "/internal/e2e/v2-surface-fault", {
    action,
    target,
  });
}

async function waitForSurfaceFault(
  control: RequestDraftFaultControl,
  faultId: string,
  state: RequestDraftFaultState,
  timeoutMs: number,
): Promise<RequestDraftFaultStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await readSurfaceFault(control, faultId);
    if (current.state === state) return current;
    if (current.state === "timedOut") throw new Error(`Surface fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for surface fault ${faultId} state ${state}`);
}

async function readSurfaceFault(
  control: RequestDraftFaultControl,
  faultId: string,
): Promise<RequestDraftFaultStatus> {
  return surfaceFaultRequest(
    control,
    "GET",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
  );
}

async function releaseSurfaceFault(
  control: RequestDraftFaultControl,
  faultId: string,
): Promise<RequestDraftFaultStatus> {
  return surfaceFaultRequest(
    control,
    "POST",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}/release`,
  );
}

async function surfaceFaultRequest(
  control: RequestDraftFaultControl,
  method: "GET" | "POST",
  requestPath: string,
  body?: object,
): Promise<RequestDraftFaultStatus> {
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
                `Companion surface fault returned ${response.statusCode ?? "unknown"}: ${responseBody}`,
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

function parseSurfaceFaultStatus(value: unknown): RequestDraftFaultStatus {
  if (!isRecord(value)) throw new Error("Companion returned an invalid surface fault status");
  const { action, faultId, state, target } = value;
  if (
    typeof faultId !== "string" ||
    !isRequestDraftFaultAction(action) ||
    !isRequestDraftFaultState(state) ||
    !isRequestDraftFaultTarget(target)
  ) {
    throw new Error("Companion returned an invalid request/draft fault status");
  }
  return { action, faultId, state, target };
}

function isRequestDraftFaultAction(value: unknown): value is RequestDraftFaultAction {
  if (!isRecord(value)) return false;
  return value.kind === "hold" || (value.kind === "fail" && typeof value.marker === "string");
}

function isRequestDraftFaultState(value: unknown): value is RequestDraftFaultState {
  return (
    value === "armed" ||
    value === "intercepted" ||
    value === "released" ||
    value === "timedOut" ||
    value === "triggered"
  );
}

function isRequestDraftFaultTarget(value: unknown): value is RequestDraftFaultTarget {
  return value === "attachmentUpload" || value === "historyPage" || value === "turnSubmit";
}
