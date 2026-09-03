import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { adb, reverseHostPort, type AndroidDevice } from "./androidDevice.ts";
import {
  delay,
  findFreePort,
  ManagedProcess,
  runCommand,
  waitForFile,
  waitForTcpPort,
} from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

export type ServerStateParityGeneration = "v1" | "v2";
export type ServerStateParityLayout = "phone" | "wide";

export type ServerStateParityCapture = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

interface ServerStateParityInput {
  capture: ServerStateParityCapture;
  driver: AppiumBrowser;
  generation: ServerStateParityGeneration;
  layout: ServerStateParityLayout;
  timeoutMs: number;
}

interface EmptyCatalogParityInput extends ServerStateParityInput {
  serverName: string;
}

interface ServerStatusParityInput extends ServerStateParityInput {
  serverName: string;
  status: ServerRowStatus;
}

interface ServerStatusTransitionParityInput extends ServerStatusParityInput {
  trigger(): Promise<void>;
}

interface MultipleServerRailParityInput extends ServerStateParityInput {
  orderedServerNames: readonly string[];
}

export interface EmptyServerStateFixtureInput {
  artifactDir: string;
  device: AndroidDevice;
  preferredDevicePort: number;
  repoRoot: string;
  runtimeDir: string;
}

export interface EmptyServerStateFixture {
  appServerProcess: ManagedProcess;
  companionProcess: ManagedProcess;
  controlEndpoint: string;
  devicePort: number;
  hostPort: number;
  tokenFile: string;
  createPairing(serverName: string): Promise<string>;
  revokeAllDevices(): Promise<void>;
}

export type ServerRowStatus =
  | "Access required"
  | "Connecting"
  | "Connection error"
  | "Disabled"
  | "Offline"
  | "Updating";

const PHONE_STATUS_ROWS: Record<ServerRowStatus, string> = {
  "Access required": "NAV-15",
  Connecting: "NAV-12",
  "Connection error": "NAV-16",
  Disabled: "NAV-17",
  Offline: "NAV-14",
  Updating: "NAV-13",
};

const WIDE_STATUS_ROWS: Partial<Record<ServerRowStatus, string>> = {
  Connecting: "RAIL-03",
  "Connection error": "RAIL-06",
  Offline: "RAIL-05",
  Updating: "RAIL-04",
};

/**
 * Starts a real App Server with an isolated CODEX_HOME and a real Companion.
 * Its catalog is empty by construction instead of being mocked in the client.
 */
export async function startEmptyServerStateFixture(
  input: EmptyServerStateFixtureInput,
): Promise<EmptyServerStateFixture> {
  const { artifactDir, device, preferredDevicePort, repoRoot, runtimeDir } = input;
  const codexHome = path.join(runtimeDir, "codex-home");
  const dataDirectory = path.join(runtimeDir, "companion-data");
  const appServerSocket = path.join(runtimeDir, "app-server.sock");
  const controlEndpoint = path.join(runtimeDir, "companion-control.sock");
  const tokenFile = path.join(runtimeDir, "companion-control.token");
  const companionBinary = path.join(repoRoot, "target", "debug", "codewide-companion");
  const hostPort = await findFreePort();
  await Promise.all([
    mkdir(codexHome, { mode: 0o700, recursive: true }),
    mkdir(dataDirectory, { mode: 0o700, recursive: true }),
  ]);
  const projectTimestamp = Date.now();
  await writeFile(
    path.join(dataDirectory, "projects.json"),
    `${JSON.stringify({
      projects: [
        {
          addedAt: projectTimestamp,
          lastUsedAt: projectTimestamp,
          name: path.basename(repoRoot),
          path: repoRoot,
          pinned: true,
        },
      ],
      version: 1,
    })}\n`,
    { mode: 0o600 },
  );
  const appServerProcess = new ManagedProcess(
    process.env.CODEWIDE_E2E_CODEX_BIN?.trim() || "codex",
    ["app-server", "--listen", `unix://${appServerSocket}`],
    {
      cwd: repoRoot,
      env: { ...process.env, CODEX_HOME: codexHome },
      logPath: path.join(artifactDir, "empty-app-server.log"),
    },
  );
  await waitForFile(appServerSocket, appServerProcess, 30_000);
  await runCommand(companionBinary, ["create-token", "--token-file", tokenFile], {
    cwd: repoRoot,
  });
  const companionProcess = new ManagedProcess(
    companionBinary,
    [
      "serve",
      "--listen",
      `127.0.0.1:${String(hostPort)}`,
      "--control-endpoint",
      controlEndpoint,
      "--state",
      path.join(runtimeDir, "companion-state.redb"),
      "--data-dir",
      dataDirectory,
      "--identity-dir",
      path.join(runtimeDir, "companion-identity"),
      "--token-file",
      tokenFile,
      "--app-server-socket",
      appServerSocket,
      "--codex-home",
      codexHome,
      "--device-registry",
      path.join(runtimeDir, "companion-devices.json"),
      "--enable-mutations",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        RUST_LOG: process.env.RUST_LOG?.trim() || "codewide_companion=debug,warn",
      },
      logPath: path.join(artifactDir, "empty-companion.log"),
    },
  );
  await waitForFile(controlEndpoint, companionProcess, 30_000);
  await waitForTcpPort(hostPort, companionProcess, 30_000);
  const devicePort = await reverseHostPort(device, repoRoot, hostPort, preferredDevicePort);
  const createPairing = async (serverName: string): Promise<string> => {
    const result = await runCommand(
      companionBinary,
      ["pair", "--control-endpoint", controlEndpoint, "--token-file", tokenFile, "--json"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CODEWIDE_PUBLIC_ENDPOINT: `ws://127.0.0.1:${String(devicePort)}/v1/sync`,
          CODEWIDE_SERVER_NAME: serverName,
        },
      },
    );
    const parsed: unknown = JSON.parse(result.stdout);
    if (!isRecord(parsed) || typeof parsed.pairingLink !== "string") {
      throw new Error("Empty-catalog Companion did not return a pairing link");
    }
    return parsed.pairingLink;
  };
  const revokeAllDevices = async (): Promise<void> => {
    const result = await runCommand(
      companionBinary,
      ["devices", "--control-endpoint", controlEndpoint, "--token-file", tokenFile],
      { cwd: repoRoot },
    );
    const parsed: unknown = JSON.parse(result.stdout);
    const devices = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.devices)
        ? parsed.devices
        : null;
    if (devices === null || devices.length === 0) {
      throw new Error("Empty-catalog Companion has no paired devices to revoke");
    }
    const ids = devices.map((device) => {
      if (!isRecord(device) || typeof device.id !== "string") {
        throw new Error("Empty-catalog Companion returned an invalid paired device");
      }
      return device.id;
    });
    for (const id of ids) {
      await runCommand(
        companionBinary,
        ["revoke", id, "--control-endpoint", controlEndpoint, "--token-file", tokenFile],
        { cwd: repoRoot },
      );
    }
  };
  return {
    appServerProcess,
    companionProcess,
    controlEndpoint,
    createPairing,
    devicePort,
    hostPort,
    revokeAllDevices,
    tokenFile,
  };
}

/** Captures the real no-saved-server shell for the current generation and viewport. */
export async function captureZeroServerNavigationParity(
  input: ServerStateParityInput,
): Promise<void> {
  const { capture, driver, generation, layout, timeoutMs } = input;
  const rowId = layout === "phone" ? "NAV-01" : "NAV-02";
  await capture(rowId, `${layout}-zero-servers`, async () => {
    await waitForAccessibility(driver, "New thread", timeoutMs);
    await waitForAccessibility(driver, "Choose server", timeoutMs);
    await waitForText(driver, "No threads found", timeoutMs);
    await assertNoSavedServerRows(driver);
    await assertHiddenAccessibility(driver, "Paste connection link");
    if (layout === "wide") {
      await waitForAccessibility(driver, "Add server", timeoutMs);
      await waitForAccessibility(driver, "Settings", timeoutMs);
    }
    const source = await driver.getPageSource();
    if (!source.includes("All threads") || source.includes("CodeWide E2E")) {
      throw new Error(`${generation} did not render the exact zero-server navigation shell`);
    }
  });
}

/** Captures selected and aggregate catalogs backed by one real, empty App Server. */
export async function captureEmptyCatalogNavigationParity(
  input: EmptyCatalogParityInput,
): Promise<void> {
  const { capture, driver, layout, serverName, timeoutMs } = input;
  await selectServer(driver, serverName, timeoutMs);
  await capture("NAV-05", `${layout}-selected-server-empty`, async () => {
    await assertEmptyThreadCatalog(driver, timeoutMs);
    await assertSelectedServer(driver, serverName, timeoutMs);
  });

  await openServerSelector(driver, timeoutMs);
  await clickAccessibilityStartingWith(driver, "All servers", timeoutMs);
  await capture("NAV-03", `${layout}-all-servers-empty`, async () => {
    await assertEmptyThreadCatalog(driver, timeoutMs);
    const source = await driver.getPageSource();
    if (!source.includes("All threads")) {
      throw new Error("The aggregate empty catalog is not selected");
    }
  });
  await selectServer(driver, serverName, timeoutMs);
}

/** Captures a real saved-server status after the caller has driven its transport into that state. */
export async function captureServerStatusParity(input: ServerStatusParityInput): Promise<void> {
  const { capture, driver, generation, layout, serverName, status, timeoutMs } = input;
  if (layout === "phone") {
    await openServerSelector(driver, timeoutMs);
    const rowId = PHONE_STATUS_ROWS[status];
    await capture(rowId, `phone-server-selector-${statusStateName(status)}`, async () => {
      await waitForServerStatus(driver, serverName, status, timeoutMs);
    });
    await driver.back();
    await waitForAccessibility(driver, "Choose server", timeoutMs);
    return;
  }
  const rowId = WIDE_STATUS_ROWS[status];
  if (rowId === undefined) {
    throw new Error(`${status} has no wide-rail parity row`);
  }
  await capture(rowId, `wide-rail-${statusStateName(status)}`, async () => {
    await waitForServerStatus(driver, serverName, status, timeoutMs);
    if (generation === "v2") {
      const enabledOnly = await driver.$(`~${serverName}, Enabled`);
      if (await enabledOnly.isDisplayed().catch(() => false)) {
        throw new Error(
          `V2 rail exposes ${serverName}, Enabled instead of the authoritative ${status} state`,
        );
      }
    }
  });
}

/** Opens the narrow selector before a transient fault so its exact status cannot disappear unseen. */
export async function captureServerStatusTransitionParity(
  input: ServerStatusTransitionParityInput,
): Promise<void> {
  const { driver, layout, trigger } = input;
  if (layout === "phone") await openServerSelector(driver, input.timeoutMs);
  await trigger();
  if (layout === "phone") {
    await captureOpenPhoneServerStatus(input);
    await driver.back();
    await waitForAccessibility(driver, "Choose server", input.timeoutMs);
    return;
  }
  await captureServerStatusParity(input);
}

/** Proves that the wide rail contains multiple real records and can reveal the last one by scrolling. */
export async function captureMultipleServerRailParity(
  input: MultipleServerRailParityInput,
): Promise<void> {
  const { capture, driver, layout, orderedServerNames, timeoutMs } = input;
  if (layout !== "wide") throw new Error("RAIL-07 requires the wide/unfolded viewport");
  if (orderedServerNames.length < 8) {
    throw new Error("RAIL-07 requires at least eight isolated saved-server records");
  }
  const firstName = orderedServerNames[0];
  const lastName = orderedServerNames.at(-1);
  if (firstName === undefined || lastName === undefined) {
    throw new Error("RAIL-07 server fixture is empty");
  }
  const first = await findServerRow(driver, firstName);
  await first.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
  const last = await findServerRow(driver, lastName);
  if (await last.isDisplayed().catch(() => false)) {
    throw new Error("RAIL-07 fixture does not overflow the wide rail before scrolling");
  }
  await scrollRailToEnd(driver, timeoutMs);
  await capture("RAIL-07", "wide-rail-multiple-servers-scrolled", async () => {
    await last.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
    if (await first.isDisplayed().catch(() => false)) {
      throw new Error("RAIL-07 did not move the rail viewport away from its first server");
    }
  });
}

/** Uses Android's real connectivity state so native connection owners emit Offline. */
export async function setAndroidNetworkOffline(
  device: AndroidDevice,
  repoRoot: string,
  offline: boolean,
): Promise<void> {
  await adb(device, repoRoot, [
    "shell",
    "cmd",
    "connectivity",
    "airplane-mode",
    offline ? "enable" : "disable",
  ]);
  await adb(device, repoRoot, [
    "shell",
    "am",
    "broadcast",
    "-a",
    "android.intent.action.AIRPLANE_MODE",
    "--ez",
    "state",
    offline ? "true" : "false",
  ]);
}

export async function waitForServerStatus(
  driver: AppiumBrowser,
  serverName: string,
  status: ServerRowStatus,
  timeoutMs: number,
): Promise<void> {
  const expected = `${serverName}, ${status}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await driver.$(
      `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(expected)}")`,
    );
    if (await row.isDisplayed().catch(() => false)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for saved-server state ${expected}`);
}

async function captureOpenPhoneServerStatus(input: ServerStatusParityInput): Promise<void> {
  const { capture, driver, serverName, status, timeoutMs } = input;
  await capture(
    PHONE_STATUS_ROWS[status],
    `phone-server-selector-${statusStateName(status)}`,
    async () => waitForServerStatus(driver, serverName, status, timeoutMs),
  );
}

async function assertEmptyThreadCatalog(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  await waitForText(driver, "No threads found", timeoutMs);
  const rows = await driver.$$('android=new UiSelector().descriptionStartsWith("Open thread ")');
  for (const row of rows) {
    if (await row.isDisplayed().catch(() => false)) {
      throw new Error("The supposedly empty catalog contains a visible thread row");
    }
  }
}

async function assertNoSavedServerRows(driver: AppiumBrowser): Promise<void> {
  const rows = await driver.$$(
    'android=new UiSelector().descriptionMatches(".+, (?:Live|Connecting(?:…)?|Updating(?:…)?|Offline|Access required|Connection error|Disabled)(?:, selected)?")',
  );
  for (const row of rows) {
    if (await row.isDisplayed().catch(() => false)) {
      throw new Error("The zero-server shell contains a saved-server row");
    }
  }
}

async function assertSelectedServer(
  driver: AppiumBrowser,
  serverName: string,
  timeoutMs: number,
): Promise<void> {
  await openServerSelector(driver, timeoutMs);
  const candidates = await driver.$$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(`${serverName}, `)}")`,
  );
  for (const candidate of candidates) {
    if (!(await candidate.isDisplayed().catch(() => false))) continue;
    if ((await candidate.getAttribute("selected")) === "true") {
      await driver.back();
      return;
    }
  }
  await driver.back();
  throw new Error(`Saved server ${serverName} is not selected`);
}

async function selectServer(
  driver: AppiumBrowser,
  serverName: string,
  timeoutMs: number,
): Promise<void> {
  await openServerSelector(driver, timeoutMs);
  const row = await findServerRow(driver, serverName);
  await row.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
  await row.click();
  await waitForAccessibility(driver, "New thread", timeoutMs);
}

async function openServerSelector(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const choose = await waitForAccessibility(driver, "Choose server", timeoutMs);
  await choose.click();
  await waitForAccessibilityStartingWith(driver, "All servers", timeoutMs);
}

async function findServerRow(driver: AppiumBrowser, serverName: string) {
  return driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(`${serverName}, `)}")`,
  );
}

async function scrollRailToEnd(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const viewport = await driver.getWindowSize();
  const candidates = await driver.$$(
    'android=new UiSelector().className("android.widget.ScrollView")',
  );
  for (const candidate of candidates) {
    if (!(await candidate.isDisplayed().catch(() => false))) continue;
    const [x, y, width, height] = await Promise.all([
      candidate.getLocation("x"),
      candidate.getLocation("y"),
      candidate.getSize("width"),
      candidate.getSize("height"),
    ]);
    if (
      x > viewport.width * 0.08 ||
      width > viewport.width * 0.15 ||
      height < viewport.height * 0.25
    ) {
      continue;
    }
    const centerX = x + Math.floor(width / 2);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await driver
        .action("pointer", { parameters: { pointerType: "touch" } })
        .move({ duration: 0, x: centerX, y: y + Math.floor(height * 0.82) })
        .down({ button: 0 })
        .move({ duration: 300, x: centerX, y: y + Math.floor(height * 0.18) })
        .up({ button: 0 })
        .perform();
      await delay(75);
    }
    return;
  }
  throw new Error(`Could not resolve the wide server rail within ${String(timeoutMs)}ms`);
}

async function waitForAccessibility(driver: AppiumBrowser, label: string, timeoutMs: number) {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
  return element;
}

async function waitForAccessibilityStartingWith(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
) {
  const element = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(label)}")`,
  );
  await element.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
  return element;
}

async function clickAccessibilityStartingWith(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibilityStartingWith(driver, label, timeoutMs);
  await element.click();
}

async function waitForText(driver: AppiumBrowser, text: string, timeoutMs: number): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  await element.waitForDisplayed({ timeout: timeoutMs, interval: 100 });
}

async function assertHiddenAccessibility(driver: AppiumBrowser, label: string): Promise<void> {
  const element = await driver.$(`~${label}`);
  if (await element.isDisplayed().catch(() => false)) {
    throw new Error(`${label} is unexpectedly visible`);
  }
}

function statusStateName(status: ServerRowStatus): string {
  return status.toLowerCase().replaceAll(" ", "-");
}

function escapeUiSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
