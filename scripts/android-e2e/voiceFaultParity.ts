import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";

import { capturePendingActionParity, capturePressedActionParity } from "./actionFailureParity.ts";
import { adb, type AndroidDevice } from "./androidDevice.ts";
import { delay } from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

export type VoiceFaultParityGeneration = "v1" | "v2";
export type VoiceFaultParityLayout = "phone" | "wide";

type CaptureParityRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

interface VoiceHarnessInput {
  capture: CaptureParityRow;
  control: {
    endpoint: string;
    tokenFile: string;
  };
  device: AndroidDevice;
  driver: AppiumBrowser;
  generation: VoiceFaultParityGeneration;
  layout: VoiceFaultParityLayout;
  nonce: string;
  packageName: string;
  repoRoot: string;
  timeoutMs: number;
}

interface VoiceFaultParityInput extends VoiceHarnessInput {
  restoreConversation(): Promise<void>;
}

interface ThreadSearchVoiceParityInput extends VoiceHarnessInput {
  restoreThreadList(): Promise<void>;
}

type SurfaceFaultAction =
  | { kind: "hold" }
  | { kind: "result"; marker: string }
  | { kind: "retry"; retryAfterMs: number };

interface SurfaceFaultStatus {
  faultId: string;
  state: "armed" | "intercepted" | "released" | "timedOut" | "triggered";
  target: "voiceFinish";
}

const VOICE_FAULT_ACTION = "dev.codewide.app.e2e.VOICE_FAULT";
const VOICE_FAULT_RECEIVER = "dev.codewide.app.e2e.V2VoiceFaultReceiver";
const VOICE_RETRY_MESSAGE = "Voice is busy. Try again in 1 seconds.";
const VOICE_ERROR_MESSAGE = "OpenAI transcription: Microphone permission was denied";

/** Captures deterministic Voice retry, failure, and transcript states through real native/server boundaries. */
export async function captureVoiceFaultParity(input: VoiceFaultParityInput): Promise<void> {
  await captureVoiceFinishPending(input);
  await restartConversation(input);
  await captureVoiceRetry(input);
  await restartConversation(input);
  await captureVoiceError(input);
  await restoreMicrophoneAndConversation(input);
  await captureVoiceTranscript(input);
  if (input.generation === "v2") await verifyActiveCaptureStopRecovery(input);
}

/** Captures the independent thread-search Voice lifecycle without using the composer surface. */
export async function captureThreadSearchVoiceParity(
  input: ThreadSearchVoiceParityInput,
): Promise<void> {
  await prepareThreadSearch(input, "");
  if (!(await hasThreadSearchVoice(input))) {
    if (input.generation === "v2") {
      throw new Error("V2 thread search does not expose its required Voice input");
    }
    await captureCurrentV1SearchVoiceAbsence(input);
    return;
  }
  await input.capture("LIST-11", `${input.layout}-search-voice-idle`, async () => {
    const voice = await waitForThreadSearchVoiceAction(input, "Voice input");
    if (!(await voice.isEnabled())) throw new Error("Thread-search Voice idle action is disabled");
    const stop = await findThreadSearchVoiceAction(input, "Stop voice input");
    if (stop !== undefined) throw new Error("Thread-search Voice is not idle");
  });
  await startThreadSearchRecording(input, true);
  await captureThreadSearchFinishPending(input);
  await restartThreadList(input);
  await captureThreadSearchRetryAndResult(input);
  await captureThreadSearchError(input);
  await restoreMicrophoneAndThreadList(input);
  await prepareThreadSearch(input, "");
}

async function startThreadSearchRecording(
  input: ThreadSearchVoiceParityInput,
  captureStarting: boolean,
): Promise<void> {
  await clickThreadSearchVoiceAction(input, "Voice input");
  if (captureStarting) {
    await input.capture("LIST-12", `${input.layout}-search-voice-starting`, async () => {
      await waitForSearchVoiceSource(input, (source) =>
        assertSearchVoiceProgress(source, input.generation, "starting"),
      );
    });
  }
  await waitForSearchVoiceSource(input, assertSearchVoiceRecording);
  await input.capture("LIST-13", `${input.layout}-search-voice-recording`, async () => {
    assertSearchVoiceRecording(await input.driver.getPageSource());
  });
  // A real PCM batch must reach Companion before the authenticated finish boundary.
  await delay(1_250);
}

async function captureThreadSearchFinishPending(
  input: ThreadSearchVoiceParityInput,
): Promise<void> {
  const fault = await armVoiceFinishFault(input, { kind: "hold" });
  await clickThreadSearchVoiceAction(input, "Stop voice input");
  await waitForSurfaceFault(input, fault.faultId, "intercepted");
  try {
    await input.capture("LIST-14", `${input.layout}-search-voice-finishing`, async () => {
      await waitForSearchVoiceSource(input, (source) =>
        assertSearchVoiceProgress(source, input.generation, "finishing"),
      );
    });
  } finally {
    await releaseSurfaceFault(input, fault.faultId);
  }
}

async function captureThreadSearchRetryAndResult(
  input: ThreadSearchVoiceParityInput,
): Promise<void> {
  const before = `SEARCHBEFORE${safeMarker(input.nonce, input.generation, input.layout)}`;
  const transcript = `SEARCHVOICE${safeMarker(input.nonce, input.generation, input.layout)}`;
  await prepareThreadSearch(input, before);
  await startThreadSearchRecording(input, false);
  const retryFault = await armVoiceFinishFault(input, { kind: "retry", retryAfterMs: 1_000 });
  await clickThreadSearchVoiceAction(input, "Stop voice input");
  await waitForSurfaceFault(input, retryFault.faultId, "triggered");
  await input.capture("LIST-15", `${input.layout}-search-voice-retry`, async () => {
    const retry = await waitForThreadSearchVoiceAction(input, "Retry voice input");
    if (!(await retry.isEnabled())) throw new Error("Thread-search Voice retry is disabled");
    await assertSearchText(input, before);
  });

  const resultFault = await armVoiceFinishFault(input, { kind: "result", marker: transcript });
  await clickThreadSearchVoiceAction(input, "Retry voice input");
  await waitForSurfaceFault(input, resultFault.faultId, "triggered");
  await input.capture("LIST-15", `${input.layout}-search-voice-retry-result`, async () => {
    await assertSearchText(input, transcript);
    const idle = await waitForThreadSearchVoiceAction(input, "Voice input");
    if (!(await idle.isEnabled())) {
      throw new Error("Thread-search Voice result did not restore its idle action");
    }
  });
}

async function captureThreadSearchError(input: ThreadSearchVoiceParityInput): Promise<void> {
  const retained = `SEARCHERROR${safeMarker(input.nonce, input.generation, input.layout)}`;
  await scheduleMicrophoneRevocation(input);
  await input.driver.terminateApp(input.packageName);
  await input.restoreThreadList();
  await prepareThreadSearch(input, retained);
  await clickThreadSearchVoiceAction(input, "Voice input");
  await denyAndroidMicrophonePermissionIfRequested(input.driver, input.timeoutMs);
  await input.capture("LIST-15", `${input.layout}-search-voice-error`, async () => {
    const idle = await waitForThreadSearchVoiceAction(input, "Voice input");
    if (!(await idle.isEnabled())) throw new Error("Thread-search Voice error action is disabled");
    const retry = await findThreadSearchVoiceAction(input, "Retry voice input");
    if (retry !== undefined) {
      throw new Error("Thread-search microphone denial incorrectly became retryable");
    }
    await assertSearchText(input, retained);
  });
}

async function captureCurrentV1SearchVoiceAbsence(
  input: ThreadSearchVoiceParityInput,
): Promise<void> {
  for (const rowId of ["LIST-11", "LIST-12", "LIST-13", "LIST-14", "LIST-15"] as const) {
    await input.capture(
      rowId,
      `${input.layout}-search-voice-absent-current-v1-${rowId}`,
      async () => {
        await waitForAccessibility(input.driver, "Search threads", input.timeoutMs);
        if (await hasThreadSearchVoice(input)) {
          throw new Error(
            "Current V1 unexpectedly gained thread-search Voice during absence capture",
          );
        }
      },
    );
  }
}

async function hasThreadSearchVoice(input: ThreadSearchVoiceParityInput): Promise<boolean> {
  return (await findThreadSearchVoiceAction(input, "Voice input")) !== undefined;
}

async function clickThreadSearchVoiceAction(
  input: ThreadSearchVoiceParityInput,
  label: "Retry voice input" | "Stop voice input" | "Voice input",
): Promise<void> {
  const action = await waitForThreadSearchVoiceAction(input, label);
  await action.click();
}

async function waitForThreadSearchVoiceAction(
  input: ThreadSearchVoiceParityInput,
  label: "Retry voice input" | "Stop voice input" | "Voice input",
) {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const action = await findThreadSearchVoiceAction(input, label);
    if (action !== undefined) return action;
    await delay(100);
  }
  throw new Error(`No displayed thread-search action ${label}`);
}

async function findThreadSearchVoiceAction(
  input: ThreadSearchVoiceParityInput,
  label: "Retry voice input" | "Stop voice input" | "Voice input",
) {
  const search = await input.driver.$("~Search threads");
  if (!(await search.isDisplayed().catch(() => false))) return undefined;
  const searchY = await search.getLocation("y");
  const searchHeight = await search.getSize("height");
  const searchCenter = searchY + searchHeight / 2;
  const candidates = [];
  for (const candidate of await input.driver.$$(`~${label}`)) {
    if (!(await candidate.isDisplayed().catch(() => false))) continue;
    const candidateY = await candidate.getLocation("y");
    const candidateHeight = await candidate.getSize("height");
    const centerDistance = Math.abs(candidateY + candidateHeight / 2 - searchCenter);
    if (centerDistance <= Math.max(searchHeight, candidateHeight)) {
      candidates.push({ candidate, centerDistance, x: await candidate.getLocation("x") });
    }
  }
  candidates.sort((left, right) => left.centerDistance - right.centerDistance || left.x - right.x);
  return candidates[0]?.candidate;
}

async function prepareThreadSearch(
  input: ThreadSearchVoiceParityInput,
  value: string,
): Promise<void> {
  const search = await waitForAccessibility(input.driver, "Search threads", input.timeoutMs);
  await search.setValue(value);
  await input.driver.hideKeyboard().catch(() => undefined);
  await assertSearchText(input, value);
}

async function assertSearchText(
  input: ThreadSearchVoiceParityInput,
  expected: string,
): Promise<void> {
  const search = await waitForAccessibility(input.driver, "Search threads", input.timeoutMs);
  const actual = await search.getText();
  if (actual !== expected) {
    throw new Error(`Thread-search Voice text mismatch: expected ${expected}, received ${actual}`);
  }
}

async function restartThreadList(input: ThreadSearchVoiceParityInput): Promise<void> {
  await input.driver.terminateApp(input.packageName);
  await input.restoreThreadList();
  await waitForAccessibility(input.driver, "Search threads", input.timeoutMs);
}

async function restoreMicrophoneAndThreadList(input: ThreadSearchVoiceParityInput): Promise<void> {
  await grantMicrophone(input);
  await restartThreadList(input);
}

async function waitForSearchVoiceSource(
  input: ThreadSearchVoiceParityInput,
  assertion: (source: string) => void,
): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  let lastFailure: unknown = null;
  while (Date.now() < deadline) {
    const source = await input.driver.getPageSource();
    try {
      assertion(source);
      return;
    } catch (cause) {
      lastFailure = cause;
      await delay(50);
    }
  }
  const detail = lastFailure instanceof Error ? `: ${lastFailure.message}` : "";
  throw new Error(`Thread-search Voice did not reach the required state${detail}`);
}

function assertSearchVoiceProgress(
  source: string,
  generation: VoiceFaultParityGeneration,
  phase: "finishing" | "starting",
): void {
  assertThreadSearchSurface(source);
  if (!source.includes('content-desc="Stop voice input"')) {
    throw new Error(`Thread-search Voice ${phase} state lacks its Stop action`);
  }
  const hasProgressBar = source.includes('class="android.widget.ProgressBar"');
  if (generation === "v1" && !hasProgressBar) {
    throw new Error(`Frozen V1 thread-search Voice ${phase} lacks its activity ProgressBar`);
  }
  if (generation === "v2" && (hasProgressBar || !source.includes('text="•••"'))) {
    throw new Error(`V2 thread-search Voice ${phase} lacks exact ShimmerText progress`);
  }
}

function assertSearchVoiceRecording(source: string): void {
  assertThreadSearchSurface(source);
  if (
    !source.includes('content-desc="Stop voice input"') ||
    source.includes('class="android.widget.ProgressBar"') ||
    source.includes('text="•••"')
  ) {
    throw new Error("Thread-search Voice did not reach the exact recording state");
  }
}

function assertThreadSearchSurface(source: string): void {
  if (
    !source.includes('content-desc="Search threads"') ||
    source.includes('content-desc="Voice recording"')
  ) {
    throw new Error("Voice state belongs to the composer instead of thread search");
  }
}

function safeMarker(
  nonce: string,
  generation: VoiceFaultParityGeneration,
  layout: VoiceFaultParityLayout,
): string {
  return `${generation}${layout}${nonce}`
    .replaceAll(/[^A-Za-z0-9]/gu, "")
    .slice(-36)
    .toUpperCase();
}

async function captureVoiceFinishPending(input: VoiceFaultParityInput): Promise<void> {
  await startRecording(input);
  const fault = await armVoiceFinishFault(input, { kind: "hold" });
  await finishRecording(input.driver, input.timeoutMs);
  await waitForSurfaceFault(input, fault.faultId, "intercepted");
  try {
    await capturePendingActionParity({
      action: "voice-finish",
      assertPending: async () => assertVoiceFinishPending(input),
      capture: input.capture,
      driver: input.driver,
      generation: input.generation,
      layout: input.layout,
      timeoutMs: input.timeoutMs,
    });
  } finally {
    await releaseSurfaceFault(input, fault.faultId);
  }
}

async function assertVoiceFinishPending(input: VoiceFaultParityInput): Promise<void> {
  const finish = await waitForAccessibility(
    input.driver,
    "Stop voice input and insert transcript",
    input.timeoutMs,
  );
  if (await finish.isEnabled()) throw new Error("Voice finish action is enabled while pending");
  const source = await input.driver.getPageSource();
  if (!source.includes('text="Transcribing…"')) {
    throw new Error("Voice finish pending state does not expose Transcribing…");
  }
  const hasProgressBar = source.includes('class="android.widget.ProgressBar"');
  if (input.generation === "v1" && !hasProgressBar) {
    throw new Error("Frozen V1 Voice finish pending state lacks its activity ProgressBar");
  }
  if (input.generation === "v2") {
    if ((await finish.getAttribute("busy")) !== "true") {
      throw new Error("V2 Voice finish pending action is not accessibility-busy");
    }
    if (hasProgressBar || !source.includes('text="•••"')) {
      throw new Error("V2 Voice finish pending state lacks exact ShimmerText progress");
    }
  }
}

async function captureVoiceRetry(input: VoiceFaultParityInput): Promise<void> {
  const fault = await armVoiceFinishFault(input, { kind: "retry", retryAfterMs: 1_000 });
  await capturePressedActionParity({
    accessibilityLabel: "Voice input",
    capture: input.capture,
    driver: input.driver,
    generation: input.generation,
    layout: input.layout,
    position: "rightmost",
    surface: "voice-input",
    timeoutMs: input.timeoutMs,
  });
  await waitForRecording(input);
  await finishRecording(input.driver, input.timeoutMs);
  await waitForSurfaceFault(input, fault.faultId, "triggered");
  await input.capture("VOICE-05", `${input.layout}-voice-retry`, async () => {
    const retry = await waitForAccessibility(
      input.driver,
      "Retry voice transcription",
      input.timeoutMs,
    );
    if (!(await retry.isEnabled())) throw new Error("Voice retry action is disabled");
    await waitForExactText(input.driver, VOICE_RETRY_MESSAGE, input.timeoutMs);
  });
}

async function captureVoiceError(input: VoiceFaultParityInput): Promise<void> {
  await scheduleMicrophoneRevocation(input);
  await input.driver.terminateApp(input.packageName);
  await input.restoreConversation();
  await clickRightmostAccessibility(input.driver, "Voice input", input.timeoutMs);
  await denyAndroidMicrophonePermissionIfRequested(input.driver, input.timeoutMs);
  await input.capture("VOICE-06", `${input.layout}-voice-error`, async () => {
    await waitForExactText(input.driver, VOICE_ERROR_MESSAGE, input.timeoutMs);
    const idle = await waitForRightmostAccessibility(input.driver, "Voice input", input.timeoutMs);
    if (!(await idle.isEnabled())) throw new Error("Voice error left the microphone disabled");
  });
}

async function verifyActiveCaptureStopRecovery(input: VoiceFaultParityInput): Promise<void> {
  await startRecording(input);
  await dispatchActiveCaptureStop(input);
  await waitForRightmostAccessibility(input.driver, "Voice input", input.timeoutMs);
  const recording = await input.driver.$("~Voice recording");
  await recording.waitForDisplayed({ interval: 100, reverse: true, timeout: input.timeoutMs });
  await restartConversation(input);
}

async function dispatchActiveCaptureStop(input: VoiceHarnessInput): Promise<void> {
  const component = `${input.packageName}/${VOICE_FAULT_RECEIVER}`;
  const output = await adb(
    input.device,
    input.repoRoot,
    [
      "shell",
      "am",
      "broadcast",
      "--receiver-foreground",
      "-a",
      VOICE_FAULT_ACTION,
      "-n",
      component,
      "--es",
      "mode",
      "stop-active-capture",
    ],
    { timeoutMs: input.timeoutMs },
  );
  if (!/Broadcast completed: result=-1, data="active-capture-stop-dispatched"/u.test(output)) {
    throw new Error(`Android rejected the E2E active-capture stop: ${output.trim()}`);
  }
}

async function captureVoiceTranscript(input: VoiceFaultParityInput): Promise<void> {
  const safeNonce = input.nonce
    .replaceAll(/[^A-Za-z0-9]/gu, "")
    .slice(-20)
    .toUpperCase();
  const transcript = `VOICEOK${safeNonce}`;
  const before = `Draft ${input.generation.toUpperCase()} ${input.layout}`;
  const expected = `${before} ${transcript}`;
  const composer = await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
  await composer.setValue(before);
  const fault = await armVoiceFinishFault(input, { kind: "result", marker: transcript });
  await startRecording(input);
  await finishRecording(input.driver, input.timeoutMs);
  await waitForSurfaceFault(input, fault.faultId, "triggered");
  await input.capture("VOICE-08", `${input.layout}-transcript-inserted-into-draft`, async () => {
    const restoredComposer = await waitForAccessibility(
      input.driver,
      "Message Codex",
      input.timeoutMs,
    );
    const actual = await restoredComposer.getText();
    if (actual !== expected) {
      throw new Error(`Voice transcript draft mismatch: expected ${expected}, received ${actual}`);
    }
  });
  await composer.clearValue().catch(async () => {
    const restoredComposer = await waitForAccessibility(
      input.driver,
      "Message Codex",
      input.timeoutMs,
    );
    await restoredComposer.clearValue();
  });
}

async function startRecording(input: VoiceFaultParityInput): Promise<void> {
  await clickRightmostAccessibility(input.driver, "Voice input", input.timeoutMs);
  await waitForRecording(input);
}

async function waitForRecording(input: VoiceFaultParityInput): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const source = await input.driver.getPageSource();
    const hasExactTimer = /text="[0-9]+:[0-9]{2}"/u.test(source);
    if (
      source.includes('content-desc="Voice recording"') &&
      source.includes('content-desc="Stop voice input and insert transcript"') &&
      hasExactTimer
    ) {
      // A real PCM batch must cross the authenticated Voice channel before finish.
      await delay(1_250);
      return;
    }
    await delay(100);
  }
  throw new Error("Real native microphone did not reach the Voice recording state");
}

async function finishRecording(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const finish = await waitForAccessibility(
    driver,
    "Stop voice input and insert transcript",
    timeoutMs,
  );
  await finish.click();
}

async function restartConversation(input: VoiceFaultParityInput): Promise<void> {
  await input.driver.terminateApp(input.packageName);
  await input.restoreConversation();
  await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
}

async function scheduleMicrophoneRevocation(input: VoiceHarnessInput): Promise<void> {
  const component = `${input.packageName}/${VOICE_FAULT_RECEIVER}`;
  const output = await adb(
    input.device,
    input.repoRoot,
    [
      "shell",
      "am",
      "broadcast",
      "--receiver-foreground",
      "-a",
      VOICE_FAULT_ACTION,
      "-n",
      component,
      "--es",
      "mode",
      "revoke-microphone-on-kill",
    ],
    { timeoutMs: input.timeoutMs },
  );
  if (!/Broadcast completed: result=-1, data="microphone-revocation-scheduled"/u.test(output)) {
    throw new Error(`Android rejected the E2E microphone revocation: ${output.trim()}`);
  }
}

async function restoreMicrophoneAndConversation(input: VoiceFaultParityInput): Promise<void> {
  await grantMicrophone(input);
  await restartConversation(input);
}

async function grantMicrophone(input: VoiceHarnessInput): Promise<void> {
  await adb(
    input.device,
    input.repoRoot,
    ["shell", "pm", "grant", input.packageName, "android.permission.RECORD_AUDIO"],
    { timeoutMs: input.timeoutMs },
  );
}

async function denyAndroidMicrophonePermissionIfRequested(
  driver: AppiumBrowser,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.min(timeoutMs, 5_000);
  while (Date.now() < deadline) {
    const deny = await driver.$(
      'android=new UiSelector().resourceIdMatches(".*:id/permission_deny_button")',
    );
    if (await deny.isDisplayed().catch(() => false)) {
      await deny.click();
      return;
    }
    const source = await driver.getPageSource();
    if (source.includes(`text="${VOICE_ERROR_MESSAGE}"`)) return;
    await delay(100);
  }
}

async function clickRightmostAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForRightmostAccessibility(driver, label, timeoutMs);
  await element.click();
}

async function waitForRightmostAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const displayed = [];
    for (const candidate of await driver.$$(`~${label}`)) {
      if (await candidate.isDisplayed().catch(() => false)) {
        displayed.push({ candidate, x: await candidate.getLocation("x") });
      }
    }
    const rightmost = displayed.sort((left, right) => right.x - left.x)[0];
    if (rightmost !== undefined) return rightmost.candidate;
    await delay(100);
  }
  throw new Error(`No displayed accessibility element ${label}`);
}

async function waitForAccessibility(driver: AppiumBrowser, label: string, timeoutMs: number) {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  return element;
}

async function waitForExactText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeSelector(text)}")`);
  await element.waitForDisplayed({ interval: 100, timeout: timeoutMs });
}

async function armVoiceFinishFault(
  input: VoiceHarnessInput,
  action: SurfaceFaultAction,
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(input, "POST", "/internal/e2e/v2-surface-fault", {
    action,
    target: "voiceFinish",
  });
}

async function waitForSurfaceFault(
  input: VoiceHarnessInput,
  faultId: string,
  state: SurfaceFaultStatus["state"],
): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const status = await surfaceFaultRequest(
      input,
      "GET",
      `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
    );
    if (status.state === state) return;
    if (status.state === "timedOut") throw new Error(`Voice surface fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Voice surface fault ${faultId} did not reach ${state}`);
}

async function releaseSurfaceFault(input: VoiceHarnessInput, faultId: string): Promise<void> {
  const released = await surfaceFaultRequest(
    input,
    "POST",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}/release`,
  );
  if (released.state !== "released") {
    throw new Error(`Voice surface fault ${faultId} was not released`);
  }
}

async function surfaceFaultRequest(
  input: VoiceHarnessInput,
  method: "GET" | "POST",
  requestPath: string,
  body?: unknown,
): Promise<SurfaceFaultStatus> {
  const token = (await readFile(input.control.tokenFile, "utf8")).trim();
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath: input.control.endpoint,
        path: requestPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(encoded === undefined
            ? {}
            : { "content-length": Buffer.byteLength(encoded), "content-type": "application/json" }),
        },
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
                `Companion Voice fault control returned ${response.statusCode ?? "unknown"}: ${responseBody}`,
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
    if (encoded !== undefined) request.write(encoded);
    request.end();
  });
}

function parseSurfaceFaultStatus(value: unknown): SurfaceFaultStatus {
  if (!isRecord(value)) throw new Error("Companion returned an invalid Voice fault status");
  const { faultId, state, target } = value;
  if (
    typeof faultId !== "string" ||
    !["armed", "intercepted", "released", "timedOut", "triggered"].includes(String(state)) ||
    target !== "voiceFinish"
  ) {
    throw new Error("Companion returned an invalid Voice fault status");
  }
  return {
    faultId,
    state: state as SurfaceFaultStatus["state"],
    target,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
