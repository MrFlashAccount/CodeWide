import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";

import { delay } from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

export type ActionFailureGeneration = "v1" | "v2";
export type ActionFailureLayout = "phone" | "wide";

export type CaptureActionFailureRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

export interface SurfaceFaultControl {
  endpoint: string;
  tokenFile: string;
}

interface ActionFailureParityInput {
  capture: CaptureActionFailureRow;
  driver: AppiumBrowser;
  generation: ActionFailureGeneration;
  layout: ActionFailureLayout;
  timeoutMs: number;
}

interface PairingFailureParityInput extends ActionFailureParityInput {
  control: SurfaceFaultControl;
  nonce: string;
}

interface NewThreadFailureParityInput extends PairingFailureParityInput {
  reopenNewThread(): Promise<void>;
  restoreConversation(): Promise<void>;
}

interface SavedServerFailureParityInput extends ActionFailureParityInput {
  disconnectTransport(): Promise<void>;
  reconnectTransport(): Promise<void>;
  serverName: string;
}

interface PressedActionParityInput extends ActionFailureParityInput {
  accessibilityLabel: string;
  position?: "first" | "rightmost";
  surface: string;
}

interface PendingActionParityInput extends ActionFailureParityInput {
  action: string;
  assertPending(): Promise<void>;
}

type SurfaceFaultTarget = "pairingExchange" | "turnSubmit";
type SurfaceFaultAction = { kind: "hold" } | { kind: "fail"; marker: string };
type SurfaceFaultState = "armed" | "intercepted" | "triggered" | "released" | "timedOut";

interface SurfaceFaultStatus {
  action: SurfaceFaultAction;
  faultId: string;
  state: SurfaceFaultState;
  target: SurfaceFaultTarget;
}

/** Captures one real pressed control while the W3C touch pointer remains down. */
export async function capturePressedActionParity(input: PressedActionParityInput): Promise<void> {
  const { accessibilityLabel, capture, driver, layout, position, surface, timeoutMs } = input;
  const control =
    position === "rightmost"
      ? await waitForRightmostAccessibility(driver, accessibilityLabel, timeoutMs)
      : await waitForAccessibility(driver, accessibilityLabel, timeoutMs);
  if (!(await control.isEnabled())) {
    throw new Error(`${surface} pressed-state control ${accessibilityLabel} is disabled`);
  }
  const [height, width, x, y] = await Promise.all([
    control.getSize("height"),
    control.getSize("width"),
    control.getLocation("x"),
    control.getLocation("y"),
  ]);
  if (height <= 0 || width <= 0) {
    throw new Error(`${surface} pressed-state control has an empty touch target`);
  }
  const centerX = x + Math.floor(width / 2);
  const centerY = y + Math.floor(height / 2);
  await driver.performActions([
    {
      actions: [
        { duration: 0, type: "pointerMove", x: centerX, y: centerY },
        { button: 0, type: "pointerDown" },
        { duration: 180, type: "pause" },
      ],
      id: "parity-finger",
      parameters: { pointerType: "touch" },
      type: "pointer",
    },
  ]);
  try {
    await capture("INT-02", `${layout}-${surface}-pressed`, async () => {
      if (!(await control.isDisplayed().catch(() => false)) || !(await control.isEnabled())) {
        throw new Error(`${surface} pressed-state control disappeared while the pointer was down`);
      }
      const source = await driver.getPageSource();
      if (!source.includes(`content-desc="${escapeXml(accessibilityLabel)}"`)) {
        throw new Error(`${surface} pressed-state capture lost ${accessibilityLabel}`);
      }
    });
  } finally {
    await driver.releaseActions();
  }
}

/** Adds a separate real artifact for one concrete asynchronous action while it is pending. */
export async function capturePendingActionParity(input: PendingActionParityInput): Promise<void> {
  const { action, capture, layout } = input;
  await capture("INT-05", `${layout}-${action}-pending`, input.assertPending);
}

/** Runs a one-shot Companion failure through the real pairing form already on screen. */
export async function capturePairingFailureParity(input: PairingFailureParityInput): Promise<void> {
  const { capture, control, driver, generation, layout, nonce, timeoutMs } = input;
  const marker = boundedMarker("PAIR_FAILURE", nonce, generation, layout);
  const fault = await armSurfaceFault(control, "pairingExchange", { kind: "fail", marker });
  await capturePressedActionParity({
    accessibilityLabel: "Connect server",
    capture,
    driver,
    generation,
    layout,
    surface: "pairing-connect",
    timeoutMs,
  });
  await waitForSurfaceFault(control, fault.faultId, "triggered", timeoutMs);
  await capture("PAIR-06", `${layout}-pairing-failure`, async () => {
    await waitForPairingFailure(driver, marker, timeoutMs);
    const source = await driver.getPageSource();
    if (source.includes("Connected. Syncing your threads now.")) {
      throw new Error("Pairing failure incorrectly exposed the success state");
    }
    const connect = await waitForAccessibility(driver, "Connect server", timeoutMs);
    if (!(await connect.isEnabled())) {
      throw new Error("Pairing failure left the Connect action permanently disabled");
    }
  });
}

/**
 * Captures new-thread pending and failure at the shared real Companion admission boundary.
 * The non-default E2E build must expose `turnSubmit`; production builds do not contain it.
 */
export async function captureNewThreadFailureParity(
  input: NewThreadFailureParityInput,
): Promise<void> {
  const {
    capture,
    control,
    driver,
    generation,
    layout,
    nonce,
    reopenNewThread,
    restoreConversation,
    timeoutMs,
  } = input;
  const pendingReply = `NEWPENDINGOK${compactNonce(nonce)}${generation.toUpperCase()}${layout.toUpperCase()}`;
  const pendingMessage = `E2E new-thread pending check. Reply exactly ${pendingReply}.`;
  const hold = await armSurfaceFault(control, "turnSubmit", { kind: "hold" });
  await enterComposerMessage(driver, pendingMessage, timeoutMs);
  await capturePressedActionParity({
    accessibilityLabel: "Send message",
    capture,
    driver,
    generation,
    layout,
    surface: "new-thread-send",
    timeoutMs,
  });
  const assertPending = async (): Promise<void> => {
    const send = await waitForAccessibility(driver, "Send message", timeoutMs);
    const source = await driver.getPageSource();
    const enabled = await send.isEnabled();
    const pendingSignal = hasPendingSignal(source);
    if (generation === "v1") {
      if (!enabled || pendingSignal) {
        throw new Error(
          "Frozen V1 must keep Send enabled without a busy or pending signal while turn/start is held",
        );
      }
      return;
    }
    if (enabled || !pendingSignal) {
      throw new Error("V2 new-thread creation did not expose a disabled busy Send action");
    }
  };
  try {
    await waitForSurfaceFault(control, hold.faultId, "intercepted", timeoutMs);
    await capture("NEW-04", `${layout}-new-thread-create-pending`, assertPending);
    await capturePendingActionParity({
      action: "new-thread-create",
      capture,
      driver,
      generation,
      layout,
      assertPending,
      timeoutMs,
    });
  } finally {
    await releaseSurfaceFault(control, hold.faultId);
  }
  await waitForPageSource(
    driver,
    (source) => !hasPendingSignal(source),
    timeoutMs,
    "new-thread pending action to settle",
  );
  await restoreConversation();
  await reopenNewThread();

  const marker = boundedMarker("NEW_FAILURE", nonce, generation, layout);
  const failure = await armSurfaceFault(control, "turnSubmit", { kind: "fail", marker });
  await enterComposerMessage(
    driver,
    `E2ENEWFAIL${compactNonce(nonce)}${generation.toUpperCase()}${layout.toUpperCase()}`,
    timeoutMs,
  );
  await capturePressedActionParity({
    accessibilityLabel: "Send message",
    capture,
    driver,
    generation,
    layout,
    surface: "new-thread-send-failure",
    timeoutMs,
  });
  await waitForSurfaceFault(control, failure.faultId, "triggered", timeoutMs);
  await capture("NEW-05", `${layout}-new-thread-create-failure`, async () => {
    const source = await waitForPageSource(
      driver,
      (candidate) => hasActionFailure(candidate, marker),
      timeoutMs,
      "new-thread create failure",
    );
    if (hasPendingSignal(source)) {
      throw new Error("New-thread failure remained in a pending state");
    }
    const composer = await waitForAccessibility(driver, "Message Codex", timeoutMs);
    if (!(await composer.isEnabled())) {
      throw new Error("New-thread failure did not return the draft to an editable state");
    }
  });
  await restoreConversation();
}

/** Captures stable disabled, reconnecting, and rejected-edit states for one real saved server. */
export async function captureSavedServerFailureParity(
  input: SavedServerFailureParityInput,
): Promise<void> {
  const {
    capture,
    disconnectTransport,
    driver,
    generation,
    layout,
    reconnectTransport,
    serverName,
    timeoutMs,
  } = input;
  const toggleLabel = `Enable ${serverName}`;
  const toggle = await waitForAccessibility(driver, toggleLabel, timeoutMs);
  if ((await toggle.getAttribute("checked")) !== "true") {
    throw new Error(`${serverName} must be enabled before saved-server parity`);
  }
  await capturePressedActionParity({
    accessibilityLabel: toggleLabel,
    capture,
    driver,
    generation,
    layout,
    surface: "saved-server-toggle",
    timeoutMs,
  });
  await capture("SET-03", `${layout}-saved-server-disabled`, async () => {
    await waitForSwitchValue(driver, toggleLabel, false, timeoutMs);
    await waitForVisibleText(driver, "Disabled", timeoutMs);
  });
  await (await waitForAccessibility(driver, toggleLabel, timeoutMs)).click();
  await waitForSwitchValue(driver, toggleLabel, true, timeoutMs);
  await waitForConnectionSettled(driver, timeoutMs);

  const assertReconnectPending = async (): Promise<void> => {
    const source = await waitForPageSource(
      driver,
      (candidate) => /(?:Connecting|Reconnecting|Updating)(?:…|\.\.\.)?/u.test(candidate),
      timeoutMs,
      "saved-server reconnect pending",
    );
    if (!source.includes(serverName)) {
      throw new Error("Reconnect pending state lost the saved-server identity");
    }
  };
  await disconnectTransport();
  try {
    await clickAccessibility(driver, `Actions for ${serverName}`, timeoutMs);
    await clickFirstVisibleText(driver, ["Reconnect", "Retry connection"], timeoutMs);
    await capture("SET-04", `${layout}-saved-server-reconnect-pending`, assertReconnectPending);
    await capturePendingActionParity({
      action: "saved-server-reconnect",
      capture,
      driver,
      generation,
      layout,
      assertPending: assertReconnectPending,
      timeoutMs,
    });
  } finally {
    await reconnectTransport();
  }
  await waitForConnectionSettled(driver, timeoutMs);

  await clickAccessibility(driver, `Actions for ${serverName}`, timeoutMs);
  await clickVisibleText(driver, "Edit server", timeoutMs);
  const tlsPin = await waitForAccessibility(driver, `TLS pin for ${serverName}`, timeoutMs);
  await tlsPin.setValue("not-a-certificate-pin");
  await clickAccessibility(driver, `Save ${serverName}`, timeoutMs);
  await capture("SET-06", `${layout}-saved-server-settings-error`, async () => {
    await waitForPageSource(
      driver,
      (source) =>
        /(?:Could not update|certificate pin|TLS pin must|pin is invalid|invalid.*pin)/iu.test(
          source,
        ) && source.includes(`content-desc="Save ${escapeXml(serverName)}"`),
      timeoutMs,
      "saved-server settings error",
    );
  });
  await clickAccessibility(driver, `Cancel editing ${serverName}`, timeoutMs);
  if (generation === "v2") {
    await driver.back();
    await waitForAccessibility(driver, "Close server settings", timeoutMs);
  }
}

async function enterComposerMessage(
  driver: AppiumBrowser,
  message: string,
  timeoutMs: number,
): Promise<void> {
  const composer = await waitForAccessibility(driver, "Message Codex", timeoutMs);
  await composer.setValue(message);
  const send = await waitForAccessibility(driver, "Send message", timeoutMs);
  if (!(await send.isEnabled())) throw new Error("New-thread Send action did not become enabled");
}

async function waitForPairingFailure(
  driver: AppiumBrowser,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  await waitForPageSource(
    driver,
    (source) =>
      source.includes(marker) ||
      /(?:Could not reach|connection code is invalid|Could not pair|pairing.*failed|Unable to claim)/iu.test(
        source,
      ),
    timeoutMs,
    "pairing failure",
  );
}

function hasPendingSignal(source: string): boolean {
  return (
    source.includes('busy="true"') ||
    /(?:Sending|Creating|Starting|waiting for the server|Send)(?:…|\.\.\.)/u.test(source)
  );
}

function hasActionFailure(source: string, marker: string): boolean {
  return (
    source.includes(marker) ||
    /(?:server rejected|Action failed|Could not create|Could not start|failed.*thread)/iu.test(
      source,
    )
  );
}

async function waitForConnectionSettled(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  await waitForPageSource(
    driver,
    (source) =>
      /(?:Live|Connected)/u.test(source) &&
      !/(?:Connecting|Reconnecting|Updating)(?:…|\.\.\.)?/u.test(source),
    timeoutMs,
    "saved-server connection settlement",
  );
}

async function waitForSwitchValue(
  driver: AppiumBrowser,
  accessibilityLabel: string,
  checked: boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toggle = await driver.$(`~${accessibilityLabel}`);
    if (
      (await toggle.isDisplayed().catch(() => false)) &&
      (await toggle.getAttribute("checked")) === String(checked)
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${accessibilityLabel} checked=${String(checked)}`);
}

async function waitForAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<WebdriverIO.Element> {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: 50, timeout: timeoutMs });
  return element as unknown as WebdriverIO.Element;
}

async function waitForRightmostAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<WebdriverIO.Element> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const displayed: { candidate: WebdriverIO.Element; x: number }[] = [];
    for (const candidate of await driver.$$(`~${label}`)) {
      if (await candidate.isDisplayed().catch(() => false)) {
        displayed.push({
          candidate: candidate as WebdriverIO.Element,
          x: await candidate.getLocation("x"),
        });
      }
    }
    const rightmost = displayed.sort((left, right) => right.x - left.x)[0];
    if (rightmost !== undefined) return rightmost.candidate;
    await delay(50);
  }
  throw new Error(`Timed out waiting for rightmost accessibility element ${label}`);
}

async function clickAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await (await waitForAccessibility(driver, label, timeoutMs)).click();
}

async function waitForVisibleText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  await element.waitForDisplayed({ interval: 50, timeout: timeoutMs });
}

async function clickVisibleText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  await element.waitForDisplayed({ interval: 50, timeout: timeoutMs });
  await element.click();
}

async function clickFirstVisibleText(
  driver: AppiumBrowser,
  labels: readonly string[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const label of labels) {
      const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(label)}")`);
      if (await element.isDisplayed().catch(() => false)) {
        await element.click();
        return;
      }
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for one of: ${labels.join(", ")}`);
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
  state: SurfaceFaultState,
  timeoutMs: number,
): Promise<SurfaceFaultStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await surfaceFaultRequest(
      control,
      "GET",
      `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
    );
    if (current.state === state) return current;
    if (current.state === "timedOut") throw new Error(`Surface fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for surface fault ${faultId} state ${state}`);
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

function parseSurfaceFaultStatus(value: unknown): SurfaceFaultStatus {
  if (!isRecord(value)) throw new Error("Companion returned an invalid surface fault status");
  const faultId = value.faultId;
  const state = value.state;
  const target = value.target;
  const action = value.action;
  if (
    typeof faultId !== "string" ||
    !isSurfaceFaultState(state) ||
    !isSurfaceFaultTarget(target) ||
    !isSurfaceFaultAction(action)
  ) {
    throw new Error("Companion returned an invalid surface fault status");
  }
  return { action, faultId, state, target };
}

function isSurfaceFaultState(value: unknown): value is SurfaceFaultState {
  return (
    value === "armed" ||
    value === "intercepted" ||
    value === "triggered" ||
    value === "released" ||
    value === "timedOut"
  );
}

function isSurfaceFaultTarget(value: unknown): value is SurfaceFaultTarget {
  return value === "pairingExchange" || value === "turnSubmit";
}

function isSurfaceFaultAction(value: unknown): value is SurfaceFaultAction {
  if (!isRecord(value)) return false;
  if (value.kind === "hold") return true;
  return value.kind === "fail" && typeof value.marker === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedMarker(
  prefix: string,
  nonce: string,
  generation: ActionFailureGeneration,
  layout: ActionFailureLayout,
): string {
  return `${prefix}_${compactNonce(nonce)}_${generation}_${layout}`.slice(0, 80);
}

function compactNonce(nonce: string): string {
  return nonce
    .replaceAll(/[^A-Za-z0-9]/gu, "")
    .slice(-16)
    .toUpperCase();
}

function escapeUiSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
