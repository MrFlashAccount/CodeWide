import { describe, expect, it } from "vitest";

import {
  adbDeviceState,
  analyzeAdaptiveLayout,
  assertShellSafeAutomationPairing,
  compactThreadControl,
  containsPackageCrash,
  isAppTopResumed,
  parsePackageFacts,
  parseStartTiming,
  parseUiNodes,
  serverControlCount,
} from "../../../scripts/android-device-gate-lib.ts";

const validUi = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node text="" content-desc="Add server" bounds="[0,80][56,136]" />
  <node text="" content-desc="Orbit, live" bounds="[0,144][56,200]" />
  <node text="" content-desc="Settings" bounds="[0,700][56,756]" />
  <node text="" content-desc="Search threads" bounds="[72,90][350,138]" />
  <node text="" content-desc="Composer menu" bounds="[380,700][475,746]" />
  <node text="" content-desc="Message Codex" bounds="[483,700][1030,746]" />
  <node text="" content-desc="Voice input" bounds="[1030,700][1076,746]" />
  <node text="" content-desc="Send message" bounds="[1076,700][1122,746]" />
</hierarchy>`;

describe("Android device evidence parser", () => {
  it("accepts both tabbed and space-aligned adb device rows", () => {
    expect(adbDeviceState("List of devices attached\nemulator-5554\tdevice product:sdk\n", "emulator-5554")).toBe("device");
    expect(adbDeviceState("List of devices attached\nemulator-5554          device product:sdk\n", "emulator-5554")).toBe("device");
    expect(adbDeviceState("List of devices attached\nemulator-5554 offline\n", "emulator-5554")).toBe("offline");
    expect(adbDeviceState("List of devices attached\n", "emulator-5554")).toBeNull();
  });

  it("distinguishes a resumed app activity from a surviving background service", () => {
    expect(isAppTopResumed(
      "topResumedActivity=ActivityRecord{abc u0 dev.codewide.app/.MainActivity t4}",
      "dev.codewide.app",
    )).toBe(true);
    expect(isAppTopResumed(
      "topResumedActivity=ActivityRecord{abc u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t7}\nServiceRecord{dev.codewide.app/.CodexConnectionService}",
      "dev.codewide.app",
    )).toBe(false);
  });

  it("detects only crashes belonging to the selected package", () => {
    expect(containsPackageCrash(
      "F/DEBUG: Cmdline: dev.codewide.app\nF/DEBUG: >>> dev.codewide.app <<<",
      "dev.codewide.app",
    )).toBe(true);
    expect(containsPackageCrash(
      "F/DEBUG: Cmdline: com.example.other\nF/DEBUG: >>> com.example.other <<<",
      "dev.codewide.app",
    )).toBe(false);
  });

  it("proves the server rail and wide menu/input/voice/send geometry", () => {
    const evidence = analyzeAdaptiveLayout(validUi);
    expect(evidence.screenWidth).toBe(1122);
    expect(evidence.composer.inputShare).toBeGreaterThan(0.7);
    expect(evidence.serverControls.serverCount).toBe(1);
    expect(evidence.serverControls.settings).not.toBeNull();
    expect(evidence.forbiddenTabsNearSearch).toEqual([]);
  });

  it("accepts the stop control while a turn is running", () => {
    const runningUi = validUi.replace('content-desc="Send message"', 'content-desc="Stop response"');
    expect(analyzeAdaptiveLayout(runningUi).composer.inputShare).toBeGreaterThan(0.7);
  });

  it("accepts one-pixel density rounding at adjacent composer edges", () => {
    const roundedUi = validUi.replace("[1030,700][1076,746]", "[1029,700][1076,746]");
    expect(analyzeAdaptiveLayout(roundedUi).composer.inputShare).toBeGreaterThan(0.7);
  });

  it("counts compact server chooser rows with trailing status icons", () => {
    const nodes = parseUiNodes('<node text="" content-desc="Desktop, offline, icon" bounds="[1,2][3,4]" />');
    expect(serverControlCount(nodes)).toBe(1);
    expect(serverControlCount(parseUiNodes('<node text="3 servers" content-desc="" bounds="[0,0][10,10]" />'))).toBe(3);
  });

  it("rejects tabs immediately below search", () => {
    const withTabs = validUi.replace(
      "</hierarchy>",
      '<node text="Running" content-desc="" clickable="true" bounds="[72,145][160,190]" /></hierarchy>',
    );
    expect(() => analyzeAdaptiveLayout(withTabs)).toThrow("Forbidden tabs below thread search");
  });

  it("does not confuse a pinned section heading with a filter tab", () => {
    const withHeading = validUi.replace(
      "</hierarchy>",
      '<node text="PINNED" content-desc="" clickable="false" bounds="[72,145][200,190]" /></hierarchy>',
    );
    expect(analyzeAdaptiveLayout(withHeading).forbiddenTabsNearSearch).toEqual([]);
  });

  it("rejects a squeezed or incorrectly ordered composer", () => {
    const squeezed = validUi.replace("[483,700][1030,746]", "[483,700][580,746]");
    expect(() => analyzeAdaptiveLayout(squeezed)).toThrow();
  });

  it("parses UI XML entities without retaining unrelated text", () => {
    const nodes = parseUiNodes('<node text="A &amp; B" content-desc="Voice input" bounds="[1,2][3,4]" />');
    expect(nodes).toEqual([{ text: "A & B", description: "Voice input", bounds: { left: 1, top: 2, right: 3, bottom: 4 }, clickable: false }]);
  });

  it("selects a compact thread and validates list plus conversation geometry", () => {
    const compactList = `<hierarchy>
      <node text="" content-desc="Choose server" clickable="true" bounds="[0,20][300,70]" />
      <node text="" content-desc="Add server" clickable="true" bounds="[900,20][960,70]" />
      <node text="" content-desc="Search threads" clickable="true" bounds="[30,90][930,140]" />
      <node text="" content-desc="Archived threads" clickable="true" bounds="[0,150][960,210]" />
      <node text="" content-desc="Private thread title" clickable="true" bounds="[0,210][960,410]" />
    </hierarchy>`;
    const compactConversation = `<hierarchy>
      <node text="" content-desc="Back to threads" clickable="true" bounds="[0,20][60,70]" />
      <node text="" content-desc="Composer menu" clickable="true" bounds="[20,700][90,750]" />
      <node text="" content-desc="Message Codex" bounds="[100,700][760,750]" />
      <node text="" content-desc="Voice input" clickable="true" bounds="[760,700][820,750]" />
      <node text="" content-desc="Send message" clickable="true" bounds="[820,700][900,750]" />
    </hierarchy>`;
    expect(compactThreadControl(parseUiNodes(compactList))?.description).toBe("Private thread title");
    const evidence = analyzeAdaptiveLayout(compactList, compactConversation);
    expect(evidence.composer.inputShare).toBeGreaterThan(0.7);
    expect(evidence.serverControls.settings).toBeNull();
  });

  it("rejects a separate settings button in the compact server header", () => {
    const compactList = validUi
      .replace('<node text="" content-desc="Orbit, live" bounds="[0,144][56,200]" />', '<node text="" content-desc="Choose server" bounds="[0,20][300,70]" />')
      .replace('<node text="" content-desc="Settings" bounds="[0,700][56,756]" />', '<node text="" content-desc="Settings" clickable="true" bounds="[840,20][900,70]" />');
    expect(() => analyzeAdaptiveLayout(compactList)).toThrow("Settings must be inside the compact server menu");
  });

  it("parses package and launch evidence", () => {
    expect(parsePackageFacts(`Packages:\n  versionCode=7 minSdk=24 targetSdk=36\n  versionName=0.2.0\n  userId=10314\n  firstInstallTime=2026-08-10 10:00:00\n  lastUpdateTime=2026-08-10 11:00:00\n`)).toEqual({
      versionName: "0.2.0",
      versionCode: 7,
      userId: 10314,
      firstInstallTime: "2026-08-10 10:00:00",
      lastUpdateTime: "2026-08-10 11:00:00",
    });
    expect(parseStartTiming("Status: ok\nLaunchState: COLD\nTotalTime: 512\nWaitTime: 530\n")).toEqual({
      status: "ok",
      launchState: "COLD",
      totalTimeMs: 512,
      waitTimeMs: 530,
    });
    expect(parsePackageFacts("  appId=10209\n  versionCode=2\n  versionName=0.1.0\n").userId).toBe(10209);
  });

  it("accepts only shell-safe one-time pairing fields", () => {
    expect(() => assertShellSafeAutomationPairing({
      displayName: "AVD test server",
      endpoint: "ws://10.0.2.2:8765/v1/sync",
      pairingToken: "a".repeat(43),
    })).not.toThrow();
    expect(() => assertShellSafeAutomationPairing({
      displayName: "server&input",
      endpoint: "ws://10.0.2.2:8765/v1/sync",
      pairingToken: "a".repeat(43),
    })).toThrow("shell-safe ASCII server name");
    expect(() => assertShellSafeAutomationPairing({
      displayName: "server",
      endpoint: "ws://10.0.2.2:8765/v1/sync?token=bad",
      pairingToken: "a".repeat(43),
    })).toThrow("query-free shell-safe endpoint");
  });
});
