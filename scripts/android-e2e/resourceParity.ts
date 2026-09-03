import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";

import { capturePendingActionParity, capturePressedActionParity } from "./actionFailureParity.ts";
import { adb, type AndroidDevice } from "./androidDevice.ts";
import { delay } from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJUlEQVR4nO3NMQEAAAgDINc/9K3hHFQgE1mS5D0ej8fj8Xg8Ho/H4/E4Hj8AAT3Rk+UAAAAASUVORK5CYII=",
  "base64",
);

// 32x32, one-frame H.264 MP4. The fixture is intentionally tiny but contains
// a real video track, so the native player must decode media rather than only
// recognize an MP4 container.
const MP4_BYTES = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAACAAAAAgAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG4bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABY21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAACAAIABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UlsBEAAAAMAQAAAAwCDxIllgAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAWgAAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAQAAQAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAC0AAAAAEAAAAUc3RjbwAAAAAAAAABAAADRgAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAxAAAACGZyZWUAAALYbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjMgMDQ4MGNiMCAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAG2WIhAAV//7sz34FN0a5i/MZbsx35143uhD/4Q==",
  "base64",
);

export type ResourceParityGeneration = "v1" | "v2";
export type ResourceParityLayout = "phone" | "wide";

export interface ResourceParityFixture {
  change: {
    content: string;
    name: string;
    path: string;
  };
  control: {
    endpoint: string;
    tokenFile: string;
  };
  image: {
    name: string;
    path: string;
    sha256: string;
  };
  localhost: {
    marker: string;
    port: number;
  };
  ownerDeviceId: string | null;
  video: {
    name: string;
    path: string;
    sha256: string;
  };
}

type CaptureParityRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

interface ResourceParityInput {
  capture: CaptureParityRow;
  device: AndroidDevice;
  driver: AppiumBrowser;
  fixture: ResourceParityFixture;
  generation: ResourceParityGeneration;
  layout: ResourceParityLayout;
  packageName: string;
  repoRoot: string;
  timeoutMs: number;
}

interface TerminalFoldParityInput extends ResourceParityInput {
  foldedState: string;
  unfoldedState: string;
}

interface EmptyAttachmentParityInput {
  capture: CaptureParityRow;
  driver: AppiumBrowser;
  generation: ResourceParityGeneration;
  layout: ResourceParityLayout;
  timeoutMs: number;
}

interface TerminalIdentity {
  columns: number;
  processId: number;
  rows: number;
}

type SurfaceFaultTarget =
  | "changeRead"
  | "portCreate"
  | "portDelete"
  | "portDiscovery"
  | "portExpire"
  | "resourceList"
  | "resourceRead"
  | "resourceRefresh"
  | "terminalChannel"
  | "terminalOpen"
  | "terminalReplay";
type SurfaceFaultAction =
  | { kind: "fail"; marker: string }
  | { kind: "hold" }
  | { kind: "replayUnavailable" };
type SurfaceFaultState = "armed" | "intercepted" | "released" | "timedOut" | "triggered";

interface SurfaceFaultStatus {
  faultId: string;
  state: SurfaceFaultState;
  target: SurfaceFaultTarget;
}

export async function createResourceParityFixture(
  artifactDir: string,
  nonce: string,
  localhostPort: number,
  localhostMarker: string,
  controlEndpoint: string,
  controlTokenFile: string,
): Promise<ResourceParityFixture> {
  const safeNonce = nonce
    .replaceAll(/[^A-Za-z0-9]/gu, "")
    .slice(-16)
    .toLowerCase();
  const name = `visual-parity-${safeNonce}.png`;
  const imagePath = path.join(artifactDir, name);
  const videoName = `visual-parity-video-${safeNonce}.mp4`;
  const videoPath = path.join(artifactDir, videoName);
  await writeFile(imagePath, PNG_BYTES, { mode: 0o600 });
  await writeFile(videoPath, MP4_BYTES, { mode: 0o600 });
  return {
    change: {
      content: "PARITY_CHANGE_CONTENT",
      name: `visual-parity-${safeNonce.slice(-12)}.txt`,
      path: "",
    },
    control: { endpoint: controlEndpoint, tokenFile: controlTokenFile },
    image: {
      name,
      path: imagePath,
      sha256: createHash("sha256").update(PNG_BYTES).digest("hex"),
    },
    localhost: { marker: localhostMarker, port: localhostPort },
    ownerDeviceId: null,
    video: {
      name: videoName,
      path: videoPath,
      sha256: createHash("sha256").update(MP4_BYTES).digest("hex"),
    },
  };
}

export async function captureAttachmentResourceParity(input: ResourceParityInput): Promise<void> {
  const { capture, device, driver, fixture, generation, layout, repoRoot, timeoutMs } = input;
  await scrollAccessibilityIntoView(driver, `Open ${fixture.image.name}`, layout, timeoutMs);
  await capture("MSG-09", `${layout}-inline-image`, async () => {
    await waitForAccessibility(driver, `Open ${fixture.image.name}`, timeoutMs);
    await assertRenderedImageSurface(driver, fixture.image.name, timeoutMs);
  });
  await openContextChip(driver, "Attachments ·", timeoutMs);
  await capturePressedActionParity({
    accessibilityLabel: `Open attachment ${fixture.image.name}`,
    capture,
    driver,
    generation,
    layout,
    surface: "attachment-open",
    timeoutMs,
  });
  await clickAccessibility(driver, `Open attachment ${fixture.image.name}`, timeoutMs);

  await capture("ATT-06", `${layout}-image-preview`, async () => {
    if (generation === "v1") {
      await Promise.all([
        waitForAccessibility(driver, `${fixture.image.name} full screen`, timeoutMs),
        waitForAccessibility(driver, "Close image", timeoutMs),
        waitForAccessibility(driver, "Image actions", timeoutMs),
      ]);
      await assertTextHidden(driver, "Image decode failed", timeoutMs);
      return;
    }
    await Promise.all([
      waitForAccessibility(driver, fixture.image.name, timeoutMs),
      waitForAccessibility(driver, "Close attachment", timeoutMs),
      waitForAccessibility(driver, "Save attachment", timeoutMs),
    ]);
    await assertAccessibilityHidden(driver, "Loading image", timeoutMs);
    await assertTextHidden(driver, "Could not load this image", timeoutMs);
  });

  const destination = `/sdcard/Download/${fixture.image.name}`;
  await adb(device, repoRoot, ["shell", "rm", "-f", destination]);
  if (generation === "v1") {
    await clickAccessibility(driver, "Image actions", timeoutMs);
    await clickVisibleText(driver, "Download", timeoutMs);
  } else {
    await clickAccessibility(driver, "Save attachment", timeoutMs);
  }
  await selectAndroidDownloadDirectory(driver, timeoutMs);
  if (generation === "v1") await waitForVisibleText(driver, "File saved", timeoutMs);
  else await waitForVisibleText(driver, `Saved ${fixture.image.name}`, timeoutMs);
  const actualHash = await waitForDeviceSha256(device, repoRoot, destination, timeoutMs);
  if (actualHash !== fixture.image.sha256) {
    throw new Error(
      `Saved attachment checksum mismatch: expected ${fixture.image.sha256}, received ${actualHash}`,
    );
  }
  await capture("ATT-08", `${layout}-attachment-saved-checksum`, async () => {
    if (generation === "v1") await waitForVisibleText(driver, "File saved", timeoutMs);
    else await waitForVisibleText(driver, `Saved ${fixture.image.name}`, timeoutMs);
    const settledHash = await waitForDeviceSha256(device, repoRoot, destination, timeoutMs);
    if (settledHash !== fixture.image.sha256) {
      throw new Error("Saved attachment changed after the successful materialization state");
    }
  });

  await clickAccessibility(
    driver,
    generation === "v1" ? "Close image" : "Close attachment",
    timeoutMs,
  );
  await scrollAccessibilityIntoView(
    driver,
    `Open attachment ${fixture.video.name}`,
    layout,
    timeoutMs,
  );
  const videoDestination = `/sdcard/Download/${fixture.video.name}`;
  await adb(device, repoRoot, ["shell", "rm", "-f", videoDestination]);
  await clickAccessibility(driver, `Open attachment ${fixture.video.name}`, timeoutMs);
  if (generation === "v1") {
    await selectAndroidDownloadDirectory(driver, timeoutMs);
    await waitForVisibleText(driver, "File saved", timeoutMs);
    const actualVideoHash = await waitForDeviceSha256(
      device,
      repoRoot,
      videoDestination,
      timeoutMs,
    );
    if (actualVideoHash !== fixture.video.sha256) {
      throw new Error(
        `Downloaded video checksum mismatch: expected ${fixture.video.sha256}, received ${actualVideoHash}`,
      );
    }
    await scrollAccessibilityIntoView(
      driver,
      `Open attachment ${fixture.video.name}`,
      layout,
      timeoutMs,
    );
  }
  await capture("ATT-07", `${layout}-inline-video-player-policy`, async () => {
    if (generation === "v1") {
      await waitForAccessibility(driver, `Open attachment ${fixture.video.name}`, timeoutMs);
      await waitForVisibleText(driver, "File saved", timeoutMs);
      const settledHash = await waitForDeviceSha256(device, repoRoot, videoDestination, timeoutMs);
      if (settledHash !== fixture.video.sha256) {
        throw new Error("Downloaded video changed after V1 materialized it");
      }
      await assertAccessibilityPrefixHidden(driver, "Video player ·", timeoutMs);
      await assertTextHidden(driver, "Loading video", timeoutMs);
      return;
    }
    await Promise.all([
      waitForAccessibility(driver, "Video player · ready", timeoutMs),
      waitForAccessibility(driver, "Close attachment", timeoutMs),
    ]);
    await assertTextHidden(driver, "Could not play this video", timeoutMs);
  });
  if (generation === "v2") {
    await clickAccessibility(driver, "Close attachment", timeoutMs);
  }
  await clickAccessibility(driver, "Close attachments", timeoutMs);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

export async function captureEmptyAttachmentPolicy(
  input: EmptyAttachmentParityInput,
): Promise<void> {
  const { capture, driver, generation, layout, timeoutMs } = input;
  if (generation === "v2") {
    await clickAccessibility(driver, "Composer menu", timeoutMs);
    await clickVisibleText(driver, "Attach file", timeoutMs);
  }
  await capture("ATT-02", `${layout}-empty-attachments-policy`, async () => {
    if (generation === "v1") {
      const disabledChip = await driver.$(
        'android=new UiSelector().descriptionStartsWith("No attachments").enabled(false)',
      );
      await disabledChip.waitForDisplayed({ interval: 200, timeout: timeoutMs });
      await assertTextHidden(driver, "No attachments in this thread.", timeoutMs);
      return;
    }
    await Promise.all([
      waitForVisibleText(driver, "Attachments · 0", timeoutMs),
      waitForAccessibility(driver, "No attachments", timeoutMs),
      waitForVisibleText(driver, "No attachments in this thread.", timeoutMs),
      waitForAccessibility(driver, "Close attachments", timeoutMs),
    ]);
  });
  if (generation === "v2") {
    await clickAccessibility(driver, "Close attachments", timeoutMs);
    await waitForAccessibility(driver, "Message Codex", timeoutMs);
  }
}

export async function captureDiscoveredPortParity(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, layout, timeoutMs } = input;
  const response = await fetch(`http://127.0.0.1:${fixture.localhost.port}/`);
  const body = await response.text();
  if (!response.ok || !body.includes(fixture.localhost.marker)) {
    throw new Error("The localhost discovery fixture is not serving its exact marker");
  }

  await clickAccessibility(driver, "Composer menu", timeoutMs);
  await clickVisibleText(driver, "Port forward", timeoutMs);
  await clickTextStartingWith(driver, "Available", timeoutMs);
  await clickAccessibility(driver, "Refresh open ports", timeoutMs);
  const forward = await driver.$(
    `android=new UiSelector().descriptionMatches("^Forward .+ port ${String(fixture.localhost.port)}$")`,
  );
  await forward.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  const forwardLabel = await forward.getAttribute("content-desc");
  if (typeof forwardLabel !== "string" || forwardLabel === "") {
    throw new Error("The discovered forwarding action has no accessibility identity");
  }
  await capturePressedActionParity({
    accessibilityLabel: forwardLabel,
    capture,
    driver,
    generation: input.generation,
    layout,
    surface: "port-forward",
    timeoutMs,
  });
  await capture("PORT-03", `${layout}-discovered-port-list`, async () => {
    await waitForAccessibilityContaining(
      driver,
      `port ${String(fixture.localhost.port)}`,
      timeoutMs,
    );
  });
  await driver.back();
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

/** Exercises the actual resource RPCs while their owning route remains mounted. */
export async function captureAttachmentAndChangesStateParity(
  input: ResourceParityInput,
): Promise<void> {
  await captureAttachmentStates(input);
  await captureChangesStates(input);
}

async function captureAttachmentStates(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  const openingFault = await armSurfaceFault(fixture, "resourceRefresh", { kind: "hold" });
  try {
    await openContextChip(driver, "Attachments ·", timeoutMs);
    await waitForSurfaceFault(fixture, openingFault.faultId, "intercepted", timeoutMs);
    await capture("ATT-01", `${layout}-attachments-loading`, async () => {
      await waitForSurfaceFault(fixture, openingFault.faultId, "intercepted", timeoutMs);
      await waitForAccessibility(driver, "Close attachments", timeoutMs);
      if (generation === "v2") {
        await waitForVisibleText(driver, "Refreshing Attachments…", timeoutMs);
      } else {
        await assertAccessibilityDisabled(driver, "Refresh session resources", timeoutMs);
        await waitForAnyProgress(driver, timeoutMs);
      }
    });
  } finally {
    await releaseSurfaceFault(fixture, openingFault.faultId);
  }
  await waitForAccessibility(driver, `Open attachment ${fixture.image.name}`, timeoutMs);

  const refreshFault = await armSurfaceFault(fixture, "resourceRefresh", { kind: "hold" });
  try {
    await clickAccessibility(driver, "Refresh session resources", timeoutMs);
    await waitForSurfaceFault(fixture, refreshFault.faultId, "intercepted", timeoutMs);
    await capture("ATT-04", `${layout}-attachments-refreshing`, async () => {
      await waitForSurfaceFault(fixture, refreshFault.faultId, "intercepted", timeoutMs);
      await waitForAccessibility(driver, `Open attachment ${fixture.image.name}`, timeoutMs);
      await assertAccessibilityDisabled(driver, "Refresh session resources", timeoutMs);
      if (generation === "v2")
        await waitForVisibleText(driver, "Refreshing Attachments…", timeoutMs);
      else await waitForAnyProgress(driver, timeoutMs);
    });
  } finally {
    await releaseSurfaceFault(fixture, refreshFault.faultId);
  }
  await waitForAccessibility(driver, `Open attachment ${fixture.image.name}`, timeoutMs);

  const marker = `ATTACHMENT_READ_FAILURE_${layout.toUpperCase()}_${generation.toUpperCase()}`;
  const failure = await armSurfaceFault(fixture, "resourceRead", { kind: "fail", marker });
  await clickAccessibility(driver, "Open attachment package.json", timeoutMs);
  await waitForSurfaceFault(fixture, failure.faultId, "triggered", timeoutMs);
  await capture("ATT-09", `${layout}-attachment-error`, async () => {
    await waitForVisibleText(driver, marker, timeoutMs);
    await waitForAccessibility(
      driver,
      generation === "v2" ? "Retry attachment action" : "Close attachments",
      timeoutMs,
    );
    if (generation === "v1") await waitForVisibleText(driver, "Retry", timeoutMs);
  });
  if (generation === "v2") {
    await clickAccessibility(driver, "Retry attachment action", timeoutMs);
    await waitForPackageJsonPreview(driver, timeoutMs);
    await assertTextHidden(driver, marker, timeoutMs);
    await clickAccessibility(driver, "Close attachment", timeoutMs);
  } else {
    await clickVisibleText(driver, "Retry", timeoutMs);
    await waitForPackageJsonPreview(driver, timeoutMs);
    await assertTextHidden(driver, marker, timeoutMs);
  }
  await clickAccessibility(driver, "Close attachments", timeoutMs);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

async function captureChangesStates(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  if (fixture.change.path === "") {
    throw new Error("Changes parity requires the exact run-bound changed file path");
  }
  const loadingFault = await armSurfaceFault(fixture, "resourceRefresh", { kind: "hold" });
  try {
    await openContextChip(driver, "Changes ·", timeoutMs);
    await waitForSurfaceFault(fixture, loadingFault.faultId, "intercepted", timeoutMs);
    await capture("CHG-01", `${layout}-changes-loading`, async () => {
      await waitForSurfaceFault(fixture, loadingFault.faultId, "intercepted", timeoutMs);
      await waitForAccessibility(
        driver,
        generation === "v1" ? "Changes options" : "Refresh changes",
        timeoutMs,
      );
      if (generation === "v1") {
        await waitForAnyProgress(driver, timeoutMs);
      } else {
        await waitForVisibleText(driver, "Refreshing Changes…", timeoutMs);
      }
    });
  } finally {
    await releaseSurfaceFault(fixture, loadingFault.faultId);
  }
  await waitForVisibleText(driver, fixture.change.name, timeoutMs);

  const current = await readFile(fixture.change.path);
  await rm(fixture.change.path, { force: true });
  try {
    await refreshChanges(driver, generation, "Last turn", timeoutMs);
    await capture("CHG-02", `${layout}-changes-empty`, async () => {
      await waitForVisibleText(
        driver,
        generation === "v2" ? "No file changes in this scope." : "0 files",
        timeoutMs,
      );
      await assertTextHidden(driver, fixture.change.name, timeoutMs);
    });
  } finally {
    await writeFile(fixture.change.path, current, { mode: 0o600 });
  }
  await refreshChanges(driver, generation, "Session", timeoutMs);
  await waitForVisibleText(driver, fixture.change.name, timeoutMs);

  const marker = `CHANGE_READ_FAILURE_${layout.toUpperCase()}_${generation.toUpperCase()}`;
  const failure = await armSurfaceFault(fixture, "changeRead", { kind: "fail", marker });
  await clickAccessibilityContaining(driver, fixture.change.name, timeoutMs);
  await waitForSurfaceFault(fixture, failure.faultId, "triggered", timeoutMs);
  await capture("CHG-07", `${layout}-changes-error`, async () => {
    await waitForVisibleText(driver, marker, timeoutMs);
    await waitForVisibleText(
      driver,
      generation === "v1" ? "Code preview failed" : "Try again",
      timeoutMs,
    );
  });
  if (generation === "v2") await clickVisibleText(driver, "Try again", timeoutMs);
  else await clickVisibleText(driver, "Retry", timeoutMs);
  await waitForVisibleText(driver, fixture.change.content, timeoutMs);
  await clickAccessibility(
    driver,
    generation === "v1" ? "Close code review" : "Close changes",
    timeoutMs,
  );
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

async function refreshChanges(
  driver: AppiumBrowser,
  generation: ResourceParityGeneration,
  v1Scope: "Last turn" | "Session",
  timeoutMs: number,
): Promise<void> {
  if (generation === "v1") {
    await clickAccessibility(driver, "Changes options", timeoutMs);
    await clickVisibleText(driver, v1Scope, timeoutMs);
  } else {
    await clickAccessibility(driver, "Refresh changes", timeoutMs);
  }
}

/** Captures a real WebSocket open held at the authenticated Companion boundary. */
export async function captureTerminalLoadingParity(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  const fault = await armSurfaceFault(fixture, "terminalOpen");
  let title = "";
  try {
    const chip = await driver.$('android=new UiSelector().descriptionStartsWith("Terminals: ")');
    if (await chip.isDisplayed().catch(() => false)) {
      await chip.click();
    } else {
      await clickAccessibility(driver, "Composer menu", timeoutMs);
      await clickVisibleText(driver, "Terminal", timeoutMs);
    }
    await waitForAccessibility(driver, "New terminal tab", timeoutMs);
    await capturePressedActionParity({
      accessibilityLabel: "New terminal tab",
      capture,
      driver,
      generation,
      layout,
      surface: "terminal-new-tab-action",
      timeoutMs,
    });
    await clickAccessibility(driver, "New terminal tab", timeoutMs);
    await waitForSurfaceFault(fixture, fault.faultId, "intercepted", timeoutMs);
    title = await selectedTerminalTitle(driver, timeoutMs);
    const assertTerminalPending = async (): Promise<void> => {
      await waitForSurfaceFault(fixture, fault.faultId, "intercepted", timeoutMs);
      await waitForAccessibility(driver, title, timeoutMs);
      if (generation === "v1") {
        const progress = await driver.$("android.widget.ProgressBar");
        await progress.waitForDisplayed({ interval: 100, timeout: timeoutMs });
      } else {
        await waitForVisibleText(driver, "Connecting", timeoutMs);
        const tab = await waitForAccessibility(driver, title, timeoutMs);
        const lifecycle = await tab.getAttribute("contentDescription").catch(() => null);
        if (lifecycle !== null && lifecycle !== title) {
          throw new Error(`Unexpected V2 terminal loading identity ${lifecycle}`);
        }
      }
    };
    await capture("TERM-01", `${layout}-terminal-loading`, assertTerminalPending);
    await capturePendingActionParity({
      action: "terminal-open",
      assertPending: assertTerminalPending,
      capture,
      driver,
      generation,
      layout,
      timeoutMs,
    });
  } finally {
    await releaseSurfaceFault(fixture, fault.faultId);
  }
  if (generation === "v2") await waitForVisibleText(driver, "Live", timeoutMs);
  else await assertProgressHidden(driver, timeoutMs);
  await clickAccessibility(driver, "Minimize terminal", timeoutMs);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

/** Exercises opening, reconnect, replay-loss, exit, and terminal-open failure as distinct runs. */
export async function captureTerminalLifecycleParity(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  await openTerminalSurface(driver, timeoutMs);

  const opening = await armSurfaceFault(fixture, "terminalOpen", { kind: "hold" });
  let openingTitle = "";
  try {
    await clickAccessibility(driver, "New terminal tab", timeoutMs);
    await waitForSurfaceFault(fixture, opening.faultId, "intercepted", timeoutMs);
    openingTitle = await selectedTerminalTitle(driver, timeoutMs);
    await capture("TERM-02", `${layout}-terminal-opening`, async () => {
      await waitForSurfaceFault(fixture, opening.faultId, "intercepted", timeoutMs);
      await assertSelectedTerminalLifecycle(
        driver,
        openingTitle,
        generation,
        "Connecting",
        timeoutMs,
      );
      if (generation === "v1") await waitForAnyProgress(driver, timeoutMs);
      else await waitForVisibleText(driver, "Connecting", timeoutMs);
    });
  } finally {
    await releaseSurfaceFault(fixture, opening.faultId);
  }
  await waitForTerminalLifecycle(driver, openingTitle, generation, "Live", timeoutMs);
  await focusTerminal(driver);
  const replayMarker = `REPLAY_${layout.toUpperCase()}_${generation.toUpperCase()}_${Date.now().toString(36)}`;
  await driver.keys(`printf '${replayMarker}\\n'`);
  await driver.pressKeyCode(66);
  await waitForVisibleText(driver, replayMarker, timeoutMs);

  const reconnecting = await armSurfaceFault(fixture, "terminalReplay", { kind: "hold" });
  try {
    await restartConnectionService(input);
    await waitForSurfaceFault(fixture, reconnecting.faultId, "intercepted", timeoutMs);
    await capture("TERM-06", `${layout}-terminal-reconnecting`, async () => {
      await waitForSurfaceFault(fixture, reconnecting.faultId, "intercepted", timeoutMs);
      await assertSelectedTerminalLifecycle(
        driver,
        openingTitle,
        generation,
        "Connecting",
        timeoutMs,
      );
      if (generation === "v1") await waitForAnyProgress(driver, timeoutMs);
      await waitForVisibleText(driver, replayMarker, timeoutMs);
    });
  } finally {
    await releaseSurfaceFault(fixture, reconnecting.faultId);
  }
  await waitForTerminalLifecycle(driver, openingTitle, generation, "Live", timeoutMs);

  const replayUnavailable = await armSurfaceFault(fixture, "terminalReplay", {
    kind: "replayUnavailable",
  });
  await restartConnectionService(input);
  await waitForSurfaceFault(fixture, replayUnavailable.faultId, "triggered", timeoutMs);
  await capture("TERM-07", `${layout}-terminal-replay-unavailable`, async () => {
    if (generation === "v2") {
      await Promise.all([
        waitForVisibleText(driver, "Terminal history is unavailable", timeoutMs),
        waitForVisibleText(
          driver,
          "The previous output could not be replayed. Retry starts a new shell.",
          timeoutMs,
        ),
        assertAccessibilityEnabled(driver, "Retry terminal after replay loss", timeoutMs),
      ]);
      await assertSelectedTerminalLifecycle(driver, openingTitle, generation, "Failed", timeoutMs);
    } else {
      await waitForVisibleText(driver, "terminal_replay_unavailable", timeoutMs);
      await assertSelectedTerminalWithoutLifecycle(driver, openingTitle, timeoutMs);
      await waitForAccessibility(driver, `Close ${openingTitle}`, timeoutMs);
      await assertAccessibilityEnabled(driver, "New terminal tab", timeoutMs);
    }
  });
  if (generation === "v2") {
    await clickAccessibility(driver, "Retry terminal after replay loss", timeoutMs);
    openingTitle = await selectedTerminalTitle(driver, timeoutMs);
  } else {
    await clickAccessibility(driver, `Close ${openingTitle}`, timeoutMs);
    await clickAccessibility(driver, "New terminal tab", timeoutMs);
    openingTitle = await selectedTerminalTitle(driver, timeoutMs);
  }
  await waitForTerminalLifecycle(driver, openingTitle, generation, "Live", timeoutMs);
  await focusTerminal(driver);
  const retryMarker = `RETRY_${layout.toUpperCase()}_${generation.toUpperCase()}_${Date.now().toString(36)}`;
  await driver.keys(`printf '${retryMarker}\\n'`);
  await driver.pressKeyCode(66);
  await waitForVisibleText(driver, retryMarker, timeoutMs);
  await capture("TERM-07", `${layout}-terminal-replay-retry-success`, async () => {
    await waitForTerminalLifecycle(driver, openingTitle, generation, "Live", timeoutMs);
    if (generation === "v2") {
      await assertSelectedTerminalLifecycle(driver, openingTitle, generation, "Live", timeoutMs);
    } else {
      await assertSelectedTerminalWithoutLifecycle(driver, openingTitle, timeoutMs);
    }
    await waitForVisibleText(driver, retryMarker, timeoutMs);
    await assertTextHidden(driver, replayMarker, timeoutMs);
    await assertTextHidden(driver, "terminal_replay_unavailable", timeoutMs);
    await assertTextHidden(driver, "Terminal history is unavailable", timeoutMs);
  });

  await focusTerminal(driver);
  const exitMarker = `EXIT_${layout.toUpperCase()}_${generation.toUpperCase()}_${Date.now().toString(36)}`;
  await driver.keys(`printf '${exitMarker}\\n'; exit 23`);
  await driver.pressKeyCode(66);
  await waitForVisibleText(driver, exitMarker, timeoutMs);
  await capture("TERM-08", `${layout}-terminal-exited`, async () => {
    await waitForVisibleText(driver, exitMarker, timeoutMs);
    if (generation === "v2") {
      await assertSelectedTerminalLifecycle(
        driver,
        openingTitle,
        generation,
        "Exited · code 23",
        timeoutMs,
      );
    } else {
      await assertSelectedTerminalWithoutLifecycle(driver, openingTitle, timeoutMs);
      await assertTextHidden(driver, "Exited · code 23", timeoutMs);
    }
    await waitForAccessibility(driver, `Close ${openingTitle}`, timeoutMs);
  });
  await clickAccessibility(driver, `Close ${openingTitle}`, timeoutMs);

  const errorMarker = `TERMINAL_OPEN_FAILURE_${layout.toUpperCase()}_${generation.toUpperCase()}`;
  const failedOpen = await armSurfaceFault(fixture, "terminalOpen", {
    kind: "fail",
    marker: errorMarker,
  });
  await clickAccessibility(driver, "New terminal tab", timeoutMs);
  await waitForSurfaceFault(fixture, failedOpen.faultId, "triggered", timeoutMs);
  const failedTitle = await selectedTerminalTitle(driver, timeoutMs);
  await capture("TERM-09", `${layout}-terminal-error`, async () => {
    await waitForVisibleText(driver, errorMarker, timeoutMs);
    await assertSelectedTerminalLifecycle(driver, failedTitle, generation, "Failed", timeoutMs);
    await Promise.all([
      assertAccessibilityEnabled(driver, "New terminal tab", timeoutMs),
      assertAccessibilityEnabled(driver, `Close ${failedTitle}`, timeoutMs),
    ]);
  });
  await clickAccessibility(driver, `Close ${failedTitle}`, timeoutMs);
  await clickAccessibility(driver, "Minimize terminal", timeoutMs);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

export async function capturePortLoadingAndErrorParity(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  if (generation === "v2") {
    const loading = await armSurfaceFault(fixture, "portDiscovery", { kind: "hold" });
    try {
      await restartApplicationAtConversation(input);
      await waitForSurfaceFault(fixture, loading.faultId, "intercepted", timeoutMs);
      await openPortsAvailable(driver, timeoutMs);
      await capture("PORT-01", `${layout}-ports-loading`, async () => {
        await waitForVisibleText(driver, "Looking for open ports…", timeoutMs);
        await waitForVisibleText(driver, "Reading localhost listeners", timeoutMs);
        await assertAccessibilityDisabled(driver, "Refresh open ports", timeoutMs);
      });
    } finally {
      await releaseSurfaceFault(fixture, loading.faultId);
    }
    await waitForAccessibilityContaining(
      driver,
      `port ${String(fixture.localhost.port)}`,
      timeoutMs,
    );
    await driver.back();
    await waitForAccessibility(driver, "Message Codex", timeoutMs);
    const errorMarker = `PORT_DISCOVERY_FAILURE_${layout.toUpperCase()}_V2`;
    const failure = await armSurfaceFault(fixture, "portDiscovery", {
      kind: "fail",
      marker: errorMarker,
    });
    await restartApplicationAtConversation(input);
    await waitForSurfaceFault(fixture, failure.faultId, "triggered", timeoutMs);
    await openPortsAvailable(driver, timeoutMs);
    await capture("PORT-08", `${layout}-ports-error`, async () => {
      await waitForVisibleText(driver, errorMarker, timeoutMs);
      await waitForVisibleText(driver, "Could not scan ports", timeoutMs);
      await assertAccessibilityEnabled(driver, "Refresh open ports", timeoutMs);
    });
    await clickAccessibility(driver, "Refresh open ports", timeoutMs);
  } else {
    await stopConnectionService(input);
    await openPortsAvailable(driver, timeoutMs);
    await capture("PORT-08", `${layout}-ports-error`, async () => {
      await waitForVisibleText(driver, "Could not scan ports", timeoutMs);
      await assertAccessibilityEnabled(driver, "Refresh open ports", timeoutMs);
    });
    await startConnectionService(input);
    await clickAccessibility(driver, "Refresh open ports", timeoutMs);
    await capture("PORT-01", `${layout}-ports-loading`, async () => {
      await waitForVisibleText(driver, "Looking for open ports…", timeoutMs);
      await waitForVisibleText(driver, "Reading localhost listeners", timeoutMs);
      await assertAccessibilityDisabled(driver, "Refresh open ports", timeoutMs);
    });
  }
  await waitForAccessibilityContaining(driver, `port ${String(fixture.localhost.port)}`, timeoutMs);
  await driver.back();
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

async function openPortsAvailable(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  await clickAccessibility(driver, "Composer menu", timeoutMs);
  await clickVisibleText(driver, "Port forward", timeoutMs);
  await clickTextStartingWith(driver, "Available", timeoutMs);
}

async function restartApplicationAtConversation(input: ResourceParityInput): Promise<void> {
  await input.driver.terminateApp(input.packageName);
  await input.driver.activateApp(input.packageName);
  await waitForAccessibility(input.driver, "Message Codex", input.timeoutMs);
}

/** Captures the explicit product split: frozen V1 exposes native forwarding only,
 * while V2 owns the bounded, expiring localhost browser lifecycle. */
export async function captureBoundedTunnelPolicy(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, generation, layout, timeoutMs } = input;
  await clickAccessibility(driver, "Composer menu", timeoutMs);
  await clickVisibleText(driver, "Port forward", timeoutMs);
  if (generation === "v1") {
    const profile = await createAndVerifyV1NativeForwarding(input);
    await capture("PORT-04", `${layout}-bounded-tunnel-active-policy`, async () => {
      await assertV1NativeForwardingLive(input, profile);
      await Promise.all([
        assertAccessibilityHidden(driver, "Open bounded localhost preview", timeoutMs),
        assertAccessibilityHidden(driver, "Open localhost tunnel", timeoutMs),
        assertAccessibilityHidden(driver, "Close browser", timeoutMs),
      ]);
    });
    await capture("PORT-05", `${layout}-bounded-tunnel-create-pending-policy`, async () => {
      await assertV1NativeForwardingLive(input, profile);
      await Promise.all([
        assertAccessibilityHidden(driver, "Open localhost tunnel", timeoutMs),
        assertTextHidden(driver, "Opening", timeoutMs),
      ]);
    });
    await capture("PORT-06", `${layout}-bounded-tunnel-revoke-pending-policy`, async () => {
      await assertV1NativeForwardingLive(input, profile);
      await Promise.all([
        assertTextHidden(driver, "Revoking bounded tunnel…", timeoutMs),
        assertAccessibilityHidden(driver, "Retry revoke", timeoutMs),
      ]);
    });
    await capture("PORT-07", `${layout}-bounded-tunnel-expiry-policy`, async () => {
      await assertV1NativeForwardingLive(input, profile);
      await Promise.all([
        assertTextHidden(driver, "This bounded tunnel expired.", timeoutMs),
        assertAccessibilityHidden(driver, "Reconnect", timeoutMs),
      ]);
    });
    await removeV1NativeForwarding(driver, profile.label, timeoutMs);
    await driver.back();
    await waitForAccessibility(driver, "Message Codex", timeoutMs);
    return;
  }

  await scrollAccessibilityIntoView(driver, "Open bounded localhost preview", layout, timeoutMs);
  await clickAccessibility(driver, "Open bounded localhost preview", timeoutMs);
  await setInputValue(
    driver,
    "Local service",
    `localhost:${String(fixture.localhost.port)}`,
    timeoutMs,
  );
  await driver.hideKeyboard().catch(() => undefined);

  const createFault = await armSurfaceFault(fixture, "portCreate");
  try {
    await clickAccessibility(driver, "Open localhost tunnel", timeoutMs);
    await waitForSurfaceFault(fixture, createFault.faultId, "intercepted", timeoutMs);
    await capture("PORT-05", `${layout}-bounded-tunnel-create-pending-policy`, async () => {
      await waitForVisibleText(driver, "Opening", timeoutMs);
      await assertAccessibilityDisabled(driver, "Open localhost tunnel", timeoutMs);
      await waitForAccessibility(driver, "Close localhost preview", timeoutMs);
    });
  } finally {
    await releaseSurfaceFault(fixture, createFault.faultId);
  }

  await Promise.all([
    waitForAccessibility(driver, "Close browser", timeoutMs),
    waitForVisibleText(driver, `localhost:${String(fixture.localhost.port)}`, timeoutMs),
    waitForVisibleText(driver, "Bounded", timeoutMs),
    waitForVisibleText(driver, fixture.localhost.marker, timeoutMs),
  ]);
  await capture("PORT-04", `${layout}-bounded-tunnel-active-policy`, async () => {
    await Promise.all([
      waitForAccessibility(driver, "Close browser", timeoutMs),
      waitForVisibleText(driver, `localhost:${String(fixture.localhost.port)}`, timeoutMs),
      waitForVisibleText(driver, "Bounded", timeoutMs),
      waitForVisibleText(driver, fixture.localhost.marker, timeoutMs),
    ]);
    await assertAccessibilityEnabled(driver, "Close browser", timeoutMs);
  });

  const deleteFault = await armSurfaceFault(fixture, "portDelete");
  try {
    await clickAccessibility(driver, "Close browser", timeoutMs);
    await waitForSurfaceFault(fixture, deleteFault.faultId, "intercepted", timeoutMs);
    await capture("PORT-06", `${layout}-bounded-tunnel-revoke-pending-policy`, async () => {
      await waitForVisibleText(driver, "Revoking bounded tunnel…", timeoutMs);
      await Promise.all([
        assertAccessibilityDisabled(driver, "Close browser", timeoutMs),
        assertAccessibilityDisabled(driver, "Retry revoke", timeoutMs),
      ]);
    });
  } finally {
    await releaseSurfaceFault(fixture, deleteFault.faultId);
  }
  await waitForAccessibility(driver, "Close localhost preview", timeoutMs);
  await clickAccessibility(driver, "Open localhost tunnel", timeoutMs);
  await Promise.all([
    waitForAccessibility(driver, "Close browser", timeoutMs),
    waitForVisibleText(driver, "Bounded", timeoutMs),
    waitForVisibleText(driver, fixture.localhost.marker, timeoutMs),
  ]);
  await captureTunnelExpiry(input);
  await driver.back();
  await waitForAccessibility(driver, "Close localhost preview", timeoutMs);
  await clickAccessibility(driver, "Close localhost preview", timeoutMs);
  await waitForAccessibility(driver, "Close ports", timeoutMs);
  await clickAccessibility(driver, "Close ports", timeoutMs);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

async function captureTunnelExpiry(input: ResourceParityInput): Promise<void> {
  const { capture, driver, fixture, layout, timeoutMs } = input;
  const ownerDeviceId = fixture.ownerDeviceId;
  if (ownerDeviceId === null) {
    throw new Error("Bounded tunnel expiry requires the exact paired E2E device owner");
  }
  const tunnelId = await waitForVisibleTunnelId(driver, timeoutMs);
  const expiry = await expireSurfaceTunnel(fixture, tunnelId, ownerDeviceId);
  if (expiry.state !== "triggered") {
    throw new Error(`Port expiry fault ${expiry.faultId} did not trigger immediately`);
  }
  await clickAccessibility(driver, "Reload", timeoutMs);
  await capture("PORT-07", `${layout}-bounded-tunnel-expiry-policy`, async () => {
    await waitForVisibleText(driver, "This bounded tunnel expired.", timeoutMs);
    await Promise.all([
      assertAccessibilityEnabled(driver, "Close browser", timeoutMs),
      assertAccessibilityEnabled(driver, "Reconnect", timeoutMs),
    ]);
    await assertAccessibilityHidden(driver, "Open localhost tunnel", timeoutMs);
  });
}

async function waitForVisibleTunnelId(driver: AppiumBrowser, timeoutMs: number): Promise<string> {
  const match = await waitForPageSourcePattern(
    driver,
    /\/v2\/tunnels\/([A-Za-z0-9._:-]+)/u,
    timeoutMs,
  );
  const tunnelId = match[1];
  if (tunnelId === undefined || tunnelId === "") {
    throw new Error("The active bounded browser did not expose its tunnel identity");
  }
  return tunnelId;
}

async function expireSurfaceTunnel(
  fixture: Pick<ResourceParityFixture, "control">,
  tunnelId: string,
  ownerDeviceId: string,
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(fixture, "POST", "/internal/e2e/v2-surface-fault", {
    action: { kind: "expire", ownerDeviceId, tunnelId },
    target: "portExpire",
  });
}

interface V1NativeForwardingProfile {
  label: string;
  remotePort: number;
}

async function createAndVerifyV1NativeForwarding(
  input: ResourceParityInput,
): Promise<V1NativeForwardingProfile> {
  const { driver, fixture, timeoutMs } = input;
  const available = await driver.$('android=new UiSelector().textStartsWith("Available ")');
  await available.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await available.click();
  await clickAccessibility(driver, "Refresh open ports", timeoutMs);
  const forward = await driver.$(
    `android=new UiSelector().descriptionMatches("^Forward .+ port ${String(fixture.localhost.port)}$")`,
  );
  await forward.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  const description = await forward.getAttribute("content-desc");
  if (typeof description !== "string") {
    throw new Error("The discovered V1 forwarding action has no accessibility identity");
  }
  const suffix = ` port ${String(fixture.localhost.port)}`;
  const label = description.slice("Forward ".length, -suffix.length);
  if (label === "") throw new Error("The discovered V1 forwarding label is empty");
  await forward.click();
  const active = await driver.$('android=new UiSelector().textStartsWith("Active ")');
  await active.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await active.click();
  const profile = { label, remotePort: fixture.localhost.port };
  await assertV1NativeForwardingLive(input, profile);

  // A green local projection alone is insufficient: open the phone listener and
  // require bytes from the exact run-bound localhost service through the secure bridge.
  await clickAccessibility(driver, `${label}, Live`, timeoutMs);
  await waitForVisibleText(driver, fixture.localhost.marker, timeoutMs);
  await clickAccessibility(driver, "Close browser", timeoutMs);
  await waitForVisibleText(driver, "Ports", timeoutMs);
  await assertV1NativeForwardingLive(input, profile);
  return profile;
}

async function assertV1NativeForwardingLive(
  input: ResourceParityInput,
  profile: V1NativeForwardingProfile,
): Promise<void> {
  const { driver, timeoutMs } = input;
  await Promise.all([
    waitForAccessibility(driver, `${profile.label}, Live`, timeoutMs),
    waitForVisibleText(driver, `:${String(profile.remotePort)} → phone :`, timeoutMs),
    waitForAccessibility(driver, `Forwarding actions ${profile.label}`, timeoutMs),
  ]);
}

async function removeV1NativeForwarding(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await clickAccessibility(driver, `Forwarding actions ${label}`, timeoutMs);
  await clickVisibleText(driver, "Remove", timeoutMs);
  await assertAccessibilityHidden(driver, `${label}, Live`, timeoutMs);
}

/** Runs from the already-folded conversation and restores that same folded state. */
export async function captureTerminalFoldParity(input: TerminalFoldParityInput): Promise<void> {
  const {
    capture,
    device,
    driver,
    foldedState,
    generation,
    packageName,
    repoRoot,
    timeoutMs,
    unfoldedState,
  } = input;
  await openTerminal(driver, timeoutMs);
  await focusTerminal(driver);
  await waitForKeyboard(driver, timeoutMs);
  await assertTerminalWorkspaceAboveIme(driver, packageName);
  await capture("TERM-04", "phone-terminal-ime", async () => {
    await waitForAccessibility(driver, "Terminal 1", timeoutMs);
    await waitForKeyboard(driver, timeoutMs);
    await assertTerminalWorkspaceAboveIme(driver, packageName);
  });
  await capture("TERM-04", "folded-terminal-ime", async () => {
    await waitForAccessibility(driver, "Terminal 1", timeoutMs);
    await waitForKeyboard(driver, timeoutMs);
    await assertTerminalWorkspaceAboveIme(driver, packageName);
  });

  const token = `CWTERM${generation.toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  const foldedBefore = await readTerminalIdentity(driver, `${token}A`, timeoutMs);
  const foldedViewport = await driver.getWindowSize();
  const unfoldedViewport = await setDeviceStateAndWait(
    device,
    driver,
    repoRoot,
    unfoldedState,
    foldedViewport,
  );
  await waitForAccessibility(driver, "Terminal 1", timeoutMs);
  await focusTerminal(driver);
  await waitForKeyboard(driver, timeoutMs);
  await delay(500);
  const unfolded = await readTerminalIdentity(driver, `${token}B`, timeoutMs);
  assertSameShell(foldedBefore, unfolded);
  assertTerminalSizeChanged(foldedBefore, unfolded);
  await capture("TERM-05", "unfolded-terminal-resize", async () => {
    await assertTerminalIdentity(driver, `${token}B`, unfolded, timeoutMs);
    await assertTerminalWorkspaceAboveIme(driver, packageName);
  });

  const foldedRestoredViewport = await setDeviceStateAndWait(
    device,
    driver,
    repoRoot,
    foldedState,
    unfoldedViewport,
  );
  if (
    foldedRestoredViewport.width !== foldedViewport.width ||
    foldedRestoredViewport.height !== foldedViewport.height
  ) {
    throw new Error(
      `Terminal fold restoration changed the viewport from ${foldedViewport.width}x${foldedViewport.height} to ${foldedRestoredViewport.width}x${foldedRestoredViewport.height}`,
    );
  }
  await waitForAccessibility(driver, "Terminal 1", timeoutMs);
  await focusTerminal(driver);
  await waitForKeyboard(driver, timeoutMs);
  await delay(500);
  const foldedRestored = await readTerminalIdentity(driver, `${token}C`, timeoutMs);
  assertSameShell(foldedBefore, foldedRestored);
  if (
    foldedRestored.rows !== foldedBefore.rows ||
    foldedRestored.columns !== foldedBefore.columns
  ) {
    throw new Error(
      `Terminal stty size did not restore: ${foldedBefore.rows}x${foldedBefore.columns} became ${foldedRestored.rows}x${foldedRestored.columns}`,
    );
  }
  await capture("TERM-05", "folded-terminal-resize", async () => {
    await assertTerminalIdentity(driver, `${token}C`, foldedRestored, timeoutMs);
    await assertTerminalWorkspaceAboveIme(driver, packageName);
  });
  await clickAccessibility(driver, "Minimize terminal", timeoutMs);
  await driver.hideKeyboard().catch(() => undefined);
  await waitForAccessibility(driver, "Message Codex", timeoutMs);
}

async function openTerminal(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const chip = await driver.$('android=new UiSelector().descriptionStartsWith("Terminals: ")');
  if (await chip.isDisplayed().catch(() => false)) {
    await chip.click();
  } else {
    await clickAccessibility(driver, "Composer menu", timeoutMs);
    await clickVisibleText(driver, "Terminal", timeoutMs);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const terminal = await driver.$("~Terminal 1");
    if (await terminal.isDisplayed().catch(() => false)) return;
    const open = await driver.$("~Open terminal");
    if (await open.isDisplayed().catch(() => false)) await open.click();
    await delay(200);
  }
  throw new Error("Terminal did not expose its first live tab");
}

async function openTerminalSurface(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const chip = await driver.$('android=new UiSelector().descriptionStartsWith("Terminals: ")');
  if (await chip.isDisplayed().catch(() => false)) {
    await chip.click();
  } else {
    await clickAccessibility(driver, "Composer menu", timeoutMs);
    await clickVisibleText(driver, "Terminal", timeoutMs);
  }
  await waitForAccessibility(driver, "New terminal tab", timeoutMs);
}

async function waitForTerminalLifecycle(
  driver: AppiumBrowser,
  title: string,
  generation: ResourceParityGeneration,
  lifecycle: "Live",
  timeoutMs: number,
): Promise<void> {
  await waitForAccessibility(driver, title, timeoutMs);
  if (generation === "v2") await waitForVisibleText(driver, lifecycle, timeoutMs);
  else await assertProgressHidden(driver, timeoutMs);
}

async function assertSelectedTerminalLifecycle(
  driver: AppiumBrowser,
  title: string,
  generation: ResourceParityGeneration,
  lifecycle: "Connecting" | "Exited · code 23" | "Failed" | "Live",
  timeoutMs: number,
): Promise<void> {
  const selected = await driver.$(
    `android=new UiSelector().description("${escapeSelector(title)}").selected(true)`,
  );
  await selected.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  if (generation === "v2") await waitForVisibleText(driver, lifecycle, timeoutMs);
}

async function assertSelectedTerminalWithoutLifecycle(
  driver: AppiumBrowser,
  title: string,
  timeoutMs: number,
): Promise<void> {
  const selected = await driver.$(
    `android=new UiSelector().description("${escapeSelector(title)}").selected(true)`,
  );
  await selected.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  const description = await selected.getAttribute("content-desc");
  if (description !== title) {
    throw new Error(
      `Frozen V1 terminal tab unexpectedly exposed lifecycle metadata: ${String(description)}`,
    );
  }
}

async function restartConnectionService(input: ResourceParityInput): Promise<void> {
  await stopConnectionService(input);
  await startConnectionService(input);
}

async function stopConnectionService(input: ResourceParityInput): Promise<void> {
  await adb(
    input.device,
    input.repoRoot,
    [
      "shell",
      "am",
      "stopservice",
      "-n",
      `${input.packageName}/dev.codewide.app.remote.CodexConnectionService`,
    ],
    { allowFailure: true },
  );
  await delay(500);
}

async function startConnectionService(input: ResourceParityInput): Promise<void> {
  await adb(input.device, input.repoRoot, [
    "shell",
    "am",
    "start-foreground-service",
    "-n",
    `${input.packageName}/dev.codewide.app.remote.CodexConnectionService`,
  ]);
  await delay(500);
}

async function focusTerminal(driver: AppiumBrowser): Promise<void> {
  const { height, width } = await driver.getWindowSize();
  await driver.execute("mobile: clickGesture", {
    x: Math.floor(width / 2),
    y: Math.floor(height * 0.6),
  });
}

async function readTerminalIdentity(
  driver: AppiumBrowser,
  token: string,
  timeoutMs: number,
): Promise<TerminalIdentity> {
  await driver.keys(`printf '${token}:%s:' "$$"; stty size | tr ' ' 'x'`);
  await driver.pressKeyCode(66);
  const pattern = new RegExp(`${token}:(\\d+):(\\d+)x(\\d+)`, "u");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await driver.getPageSource();
    const match = pattern.exec(source);
    if (match !== null) {
      const processId = Number(match[1]);
      const rows = Number(match[2]);
      const columns = Number(match[3]);
      if (
        Number.isSafeInteger(processId) &&
        Number.isSafeInteger(rows) &&
        Number.isSafeInteger(columns) &&
        rows > 0 &&
        columns > 0
      ) {
        return { columns, processId, rows };
      }
    }
    await delay(200);
  }
  throw new Error(`Terminal did not render the stty identity marker ${token}`);
}

async function assertTerminalIdentity(
  driver: AppiumBrowser,
  token: string,
  expected: TerminalIdentity,
  timeoutMs: number,
): Promise<void> {
  const actual = await waitForPageSourcePattern(
    driver,
    new RegExp(`${token}:(\\d+):(\\d+)x(\\d+)`, "u"),
    timeoutMs,
  );
  const values = actual.slice(1).map(Number);
  if (
    values[0] !== expected.processId ||
    values[1] !== expected.rows ||
    values[2] !== expected.columns
  ) {
    throw new Error(`Terminal identity marker ${token} changed before capture`);
  }
}

function assertSameShell(first: TerminalIdentity, second: TerminalIdentity): void {
  if (first.processId !== second.processId) {
    throw new Error(
      `Terminal fold transition replaced the shell process ${String(first.processId)} with ${String(second.processId)}`,
    );
  }
}

function assertTerminalSizeChanged(first: TerminalIdentity, second: TerminalIdentity): void {
  if (first.rows === second.rows && first.columns === second.columns) {
    throw new Error(
      `Terminal stty size stayed ${String(first.rows)}x${String(first.columns)} across a real fold transition`,
    );
  }
}

async function setDeviceStateAndWait(
  device: AndroidDevice,
  driver: AppiumBrowser,
  repoRoot: string,
  state: string,
  previous: { height: number; width: number },
): Promise<{ height: number; width: number }> {
  await adb(device, repoRoot, ["shell", "cmd", "device_state", "state", state]);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await driver.getWindowSize();
    if (current.width !== previous.width || current.height !== previous.height) return current;
    await delay(200);
  }
  throw new Error(`Fold state ${state} did not resize the terminal viewport`);
}

async function assertTerminalWorkspaceAboveIme(
  driver: AppiumBrowser,
  packageName: string,
): Promise<void> {
  const source = await driver.getPageSource();
  const nodes = [...source.matchAll(/<node\b[^>]*>/gu)].map((match) => match[0]);
  const imeTop = Math.min(
    ...nodes
      .filter((node) =>
        /\bpackage="[^"]*(?:inputmethod|honeyboard|keyboard|swiftkey)[^"]*"/iu.test(node),
      )
      .map(readNodeBounds)
      .filter((bounds): bounds is NodeBounds => bounds !== null)
      .map((bounds) => bounds.top),
  );
  if (!Number.isFinite(imeTop)) {
    throw new Error("Could not resolve Android IME bounds for the terminal geometry check");
  }
  const workspace = nodes.find(
    (node) =>
      node.includes(`package="${packageName}"`) &&
      /\bresource-id="[^"]*(?:v2-)?terminal-workspace"/u.test(node),
  );
  const workspaceBounds = workspace === undefined ? null : readNodeBounds(workspace);
  if (workspaceBounds === null) {
    throw new Error("Could not resolve the terminal workspace bounds during the IME check");
  }
  if (workspaceBounds.bottom > imeTop) {
    throw new Error(
      `Terminal workspace overlaps the IME: workspace bottom ${String(workspaceBounds.bottom)}, IME top ${String(imeTop)}`,
    );
  }
}

interface NodeBounds {
  bottom: number;
  top: number;
}

function readNodeBounds(node: string): NodeBounds | null {
  const match = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
  if (match === null) return null;
  const top = Number(match[2]);
  const bottom = Number(match[4]);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  return { bottom, top };
}

async function selectAndroidDownloadDirectory(
  driver: AppiumBrowser,
  timeoutMs: number,
): Promise<void> {
  let downloads = await driver.$('android=new UiSelector().text("Downloads")');
  if (!(await downloads.isDisplayed().catch(() => false))) {
    const roots = await driver.$('android=new UiSelector().descriptionContains("Show roots")');
    if (await roots.isDisplayed().catch(() => false)) await roots.click();
    downloads = await driver.$('android=new UiSelector().text("Downloads")');
    await downloads.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  }
  await downloads.click();
  const selectedFolder = await driver.$('android=new UiSelector().text("Downloads")');
  await selectedFolder.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await clickVisibleText(driver, "Use this folder", timeoutMs);
  const allow = await driver.$('android=new UiSelector().textStartsWith("Allow")');
  if (await allow.isDisplayed().catch(() => false)) await allow.click();
}

async function waitForDeviceSha256(
  device: AndroidDevice,
  repoRoot: string,
  devicePath: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = await adb(device, repoRoot, ["shell", "sha256sum", devicePath], {
      allowFailure: true,
    });
    const match = /^([a-f0-9]{64})\s/u.exec(output.trim());
    if (match?.[1] !== undefined) return match[1];
    await delay(200);
  }
  throw new Error(`Android did not materialize ${devicePath}`);
}

async function waitForKeyboard(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await driver.isKeyboardShown()) return;
    await delay(100);
  }
  throw new Error("Android IME did not open over the terminal");
}

async function selectedTerminalTitle(driver: AppiumBrowser, timeoutMs: number): Promise<string> {
  const selected = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Terminal ").selected(true)',
  );
  await selected.waitForDisplayed({ interval: 100, timeout: timeoutMs });
  const title = await selected.getAttribute("content-desc");
  if (typeof title !== "string" || !/^Terminal \d+$/u.test(title)) {
    throw new Error("The pending terminal tab has no stable selected identity");
  }
  return title;
}

async function assertProgressHidden(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const progress = await driver.$("android.widget.ProgressBar");
  await progress.waitForDisplayed({ interval: 100, reverse: true, timeout: timeoutMs });
}

async function waitForAccessibility(driver: AppiumBrowser, label: string, timeoutMs: number) {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  return element;
}

async function assertAccessibilityEnabled(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibility(driver, label, timeoutMs);
  if (!(await element.isEnabled())) throw new Error(`${label} is unexpectedly disabled`);
}

async function assertAccessibilityDisabled(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibility(driver, label, timeoutMs);
  if (await element.isEnabled()) throw new Error(`${label} is unexpectedly enabled`);
}

async function clickAccessibility(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await waitForAccessibility(driver, label, timeoutMs);
  await element.click();
}

async function clickAccessibilityContaining(
  driver: AppiumBrowser,
  fragment: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionContains("${escapeSelector(fragment)}")`,
  );
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await element.click();
}

async function waitForAnyProgress(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const progress = await driver.$("android.widget.ProgressBar");
  await progress.waitForDisplayed({ interval: 100, timeout: timeoutMs });
}

async function waitForPackageJsonPreview(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const source = await driver.getPageSource();
    if (
      source.includes("&quot;name&quot;: &quot;codewide&quot;") ||
      source.includes('"name": "codewide"')
    ) {
      return;
    }
    await delay(200);
  }
  throw new Error("The retried package.json attachment never rendered its exact file content");
}

async function clickVisibleText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`android=new UiSelector().text("${escapeSelector(text)}")`);
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await element.click();
}

async function clickTextStartingWith(
  driver: AppiumBrowser,
  prefix: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().textStartsWith("${escapeSelector(prefix)}")`,
  );
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await element.click();
}

async function setInputValue(
  driver: AppiumBrowser,
  label: string,
  value: string,
  timeoutMs: number,
): Promise<void> {
  const input = await waitForAccessibility(driver, label, timeoutMs);
  await input.click();
  await input.clearValue();
  await input.setValue(value);
  const actual = await input.getText();
  if (actual !== value) {
    throw new Error(`Input ${label} contains ${actual} instead of ${value}`);
  }
}

async function waitForVisibleText(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().textContains("${escapeSelector(text)}")`,
  );
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
}

async function openContextChip(
  driver: AppiumBrowser,
  prefix: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeSelector(prefix)}")`,
  );
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
  await element.click();
}

async function scrollAccessibilityIntoView(
  driver: AppiumBrowser,
  label: string,
  layout: ResourceParityLayout,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const { height, width } = await driver.getWindowSize();
  const left = layout === "phone" ? 8 : Math.floor(width * 0.38);
  const area = {
    height: Math.max(1, Math.floor(height * 0.68)),
    left,
    top: Math.floor(height * 0.14),
    width: Math.max(1, width - left - 8),
  };
  let direction: "down" | "up" = "up";
  while (Date.now() < deadline) {
    const element = await driver.$(`~${label}`);
    if (await element.isDisplayed().catch(() => false)) return;
    const canScroll: unknown = await driver.execute("mobile: scrollGesture", {
      ...area,
      direction,
      percent: 0.82,
    });
    if (canScroll !== true) direction = direction === "up" ? "down" : "up";
    await delay(120);
  }
  throw new Error(`Could not scroll ${label} into the bounded resource viewport`);
}

async function waitForAccessibilityContaining(
  driver: AppiumBrowser,
  fragment: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionContains("${escapeSelector(fragment)}")`,
  );
  await element.waitForDisplayed({ interval: 200, timeout: timeoutMs });
}

async function assertRenderedImageSurface(
  driver: AppiumBrowser,
  imageLabel: string,
  timeoutMs: number,
): Promise<void> {
  const image = await waitForAccessibility(driver, imageLabel, timeoutMs);
  const [className, size] = await Promise.all([image.getAttribute("className"), image.getSize()]);
  if (className !== "android.widget.ImageView") {
    throw new Error(`Inline image ${imageLabel} rendered as ${String(className)}, not ImageView`);
  }
  if (size.width < 100 || size.height < 80) {
    throw new Error(
      `Inline image ${imageLabel} has an invalid ${String(size.width)}x${String(size.height)} surface`,
    );
  }
}

async function assertAccessibilityPrefixHidden(
  driver: AppiumBrowser,
  prefix: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeSelector(prefix)}")`,
  );
  await element.waitForDisplayed({ interval: 100, reverse: true, timeout: timeoutMs });
}

async function assertAccessibilityHidden(
  driver: AppiumBrowser,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(`~${label}`);
  await element.waitForDisplayed({ interval: 100, reverse: true, timeout: timeoutMs });
}

async function assertTextHidden(
  driver: AppiumBrowser,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().textContains("${escapeSelector(text)}")`,
  );
  await element.waitForDisplayed({ interval: 100, reverse: true, timeout: timeoutMs });
}

async function waitForPageSourcePattern(
  driver: AppiumBrowser,
  pattern: RegExp,
  timeoutMs: number,
): Promise<RegExpExecArray> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = pattern.exec(await driver.getPageSource());
    if (match !== null) return match;
    await delay(200);
  }
  throw new Error(`Android page source did not contain ${String(pattern)}`);
}

async function armSurfaceFault(
  fixture: Pick<ResourceParityFixture, "control">,
  target: SurfaceFaultTarget,
  action: SurfaceFaultAction = { kind: "hold" },
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(fixture, "POST", "/internal/e2e/v2-surface-fault", {
    action,
    target,
  });
}

async function waitForSurfaceFault(
  fixture: Pick<ResourceParityFixture, "control">,
  faultId: string,
  state: SurfaceFaultState,
  timeoutMs: number,
): Promise<SurfaceFaultStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await surfaceFaultRequest(
      fixture,
      "GET",
      `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
    );
    if (status.state === state) return status;
    if (status.state === "timedOut") throw new Error(`Surface fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for surface fault ${faultId} state ${state}`);
}

async function releaseSurfaceFault(
  fixture: Pick<ResourceParityFixture, "control">,
  faultId: string,
): Promise<SurfaceFaultStatus> {
  return surfaceFaultRequest(
    fixture,
    "POST",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}/release`,
  );
}

async function surfaceFaultRequest(
  fixture: Pick<ResourceParityFixture, "control">,
  method: "GET" | "POST",
  requestPath: string,
  body?: object,
): Promise<SurfaceFaultStatus> {
  const token = (await readFile(fixture.control.tokenFile, "utf8")).trim();
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
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
        socketPath: fixture.control.endpoint,
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Companion returned an invalid surface fault status");
  }
  const faultId = Reflect.get(value, "faultId");
  const state = Reflect.get(value, "state");
  const target = Reflect.get(value, "target");
  if (
    typeof faultId !== "string" ||
    !isSurfaceFaultState(state) ||
    (target !== "changeRead" &&
      target !== "portCreate" &&
      target !== "portDelete" &&
      target !== "portDiscovery" &&
      target !== "portExpire" &&
      target !== "resourceList" &&
      target !== "resourceRead" &&
      target !== "resourceRefresh" &&
      target !== "terminalChannel" &&
      target !== "terminalOpen" &&
      target !== "terminalReplay")
  ) {
    throw new Error("Companion returned an invalid surface fault status");
  }
  return { faultId, state, target };
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

function escapeSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
