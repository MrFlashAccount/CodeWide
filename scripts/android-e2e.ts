import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { remote } from "webdriverio";

import { AppServerClient } from "./android-e2e/appServerClient.ts";
import {
  acquireAndroidDevice,
  adb,
  captureLogcat,
  installFreshApp,
  openDeepLink,
  removeReversePort,
  reversePort,
  type AndroidDevice,
} from "./android-e2e/androidDevice.ts";
import {
  delay,
  findFreePort,
  ManagedProcess,
  runCommand,
  waitForFile,
  waitForHttpStatus,
  waitForTcpPort,
} from "./android-e2e/process.ts";
import { writeE2eReport } from "./android-e2e/report.ts";
import {
  armCommandFault,
  assertCompanionAdmissionCount,
  releaseCommandFault,
  waitForClientDurableCreate,
  waitForCommandFault,
  waitForCompanionAdmission,
} from "./android-e2e/faultControl.ts";
import { createAndroidE2eUi, type AppiumBrowser } from "./android-e2e/ui.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE_NAME = "dev.codexremote.app.e2e";
const ACTIVITY_NAME = "dev.codewide.app.MainActivity";
const APPIUM_DRIVER_VERSION = "8.5.0";
const APP_SERVER_TIMEOUT_MS = 180_000;
const UI_TIMEOUT_MS = 60_000;
const APK_PATH = path.join(REPO_ROOT, "apps/android/android/app/build/outputs/apk/e2e/app-e2e.apk");

type StepEvidence = {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

type Evidence = {
  runId: string;
  passed: boolean;
  deviceSerial: string | null;
  threadId: string | null;
  steps: StepEvidence[];
  observations: E2EObservation[];
  videos: string[];
  failure: string | null;
};

type E2EObservation = {
  stage: string;
  source: string;
  elapsedMs: number;
  outcome: string;
  operationId?: string;
};

const runId = `${timestamp()}-${randomUUID().slice(0, 8)}`;
const artifactDir = path.join(REPO_ROOT, "test-results", "android-e2e", runId);
const steps: StepEvidence[] = [];
const videos: string[] = [];
const observations: E2EObservation[] = [];
const startedAt = performance.now();
const {
  caseWithVideo,
  clickAccessibility,
  clickFirstAccessibilityExcept,
  openProjectedThreadContaining,
  sendComposerMessage,
  waitForAccessibility,
  waitForAccessibilityHidden,
  waitForApplicationReady,
  waitForConnectionReady,
  waitForRecoveredConversation,
  waitForTextHidden,
  waitForVisibleTextContaining,
} = createAndroidE2eUi({ artifactDir, step, timeoutMs: UI_TIMEOUT_MS, videos });

await main();

async function main(): Promise<void> {
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  await chmod(artifactDir, 0o700);
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "codewide-android-e2e-"));
  await chmod(runtimeDir, 0o700);
  const processes: ManagedProcess[] = [];
  const reversePorts: number[] = [];
  let device: AndroidDevice | null = null;
  let driver: AppiumBrowser | null = null;
  let appServer: AppServerClient | null = null;
  let threadId: string | null = null;
  let failure: Error | null = null;

  try {
    await step("prepare Appium UiAutomator2", ensureAppiumDriver);
    if (!process.argv.includes("--skip-build")) {
      await step("build Companion", async () => {
        await runCommand(
          "cargo",
          ["build", "-p", "codewide-companion", "--features", "e2e-command-fault"],
          {
            cwd: REPO_ROOT,
            env: { ...processEnv(), CARGO_INCREMENTAL: "0" },
            timeoutMs: 600_000,
          },
        );
      });
      await step("build isolated Android E2E APK", async () => {
        await runCommand("sh", ["scripts/android-gradle.sh", ":app:assembleE2e"], {
          cwd: REPO_ROOT,
          timeoutMs: 900_000,
        });
      });
    }

    device = await step("acquire Android virtual device", () =>
      acquireAndroidDevice(REPO_ROOT, artifactDir),
    );
    const metroPort = await findFreePort();
    const companionPort = await findFreePort();
    const appiumPort = await findFreePort();

    const companion = await startCompanion(runtimeDir, companionPort);
    processes.push(companion.process);
    const metro = await startMetro(metroPort);
    processes.push(metro);
    await step("reverse Metro and Companion ports", async () => {
      await reversePort(device!, REPO_ROOT, metroPort);
      reversePorts.push(metroPort);
      await reversePort(device!, REPO_ROOT, companionPort);
      reversePorts.push(companionPort);
    });
    await step("install fresh isolated E2E app", async () => {
      await installFreshApp(device!, REPO_ROOT, APK_PATH, PACKAGE_NAME);
      await adb(device!, REPO_ROOT, ["logcat", "-c"], { allowFailure: true });
    });

    const appium = await startAppium(appiumPort, device.sdkRoot);
    processes.push(appium);
    driver = await step("open Appium session", () =>
      remote({
        protocol: "http",
        hostname: "127.0.0.1",
        port: appiumPort,
        path: "/",
        logLevel: "error",
        capabilities: {
          platformName: "Android",
          "appium:automationName": "UiAutomator2",
          "appium:udid": device!.serial,
          "appium:appPackage": PACKAGE_NAME,
          "appium:appActivity": ACTIVITY_NAME,
          "appium:noReset": true,
          "appium:autoGrantPermissions": true,
          "appium:newCommandTimeout": 600,
          "appium:disableWindowAnimation": false,
        },
      }),
    );

    appServer = await step("connect authoritative App Server oracle", () =>
      AppServerClient.connect(appServerSocket()),
    );
    const pairingLink = await createPairing(
      companion.controlEndpoint,
      companion.tokenFile,
      companionPort,
    );
    await caseWithVideo(driver, "01-pairing-and-chat-creation", async () => {
      const metroUrl = `http://127.0.0.1:${metroPort}`;
      const devClientUrl = `codewide://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, devClientUrl);
      await waitForApplicationReady(driver!);
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, pairingLink);
      await clickAccessibility(driver!, "Connect server");
      await waitForAccessibility(driver!, "New thread");
    });

    const nonce = runId.replaceAll(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!process.argv.includes("--v2-only")) {
      const baselineIds = new Set((await appServer.listThreads()).map(({ id }) => id));
      const mobileReply = `MOBILEOK${nonce}`;
      const mobileMessage = `E2EMOBILE${nonce}. Reply exactly ${mobileReply}.`;
      await caseWithVideo(driver, "02-mobile-foreground", async () => {
        await clickAccessibility(driver!, "New thread");
        await waitForConnectionReady(driver!);
        await sendComposerMessage(driver!, mobileMessage);
        threadId = await appServer!.findNewThreadWithUserText(
          baselineIds,
          mobileMessage,
          APP_SERVER_TIMEOUT_MS,
        );
        await appServer!.waitForAgentText(threadId, mobileReply, APP_SERVER_TIMEOUT_MS);
        await waitForVisibleTextContaining(driver!, mobileReply);
      });

      const backgroundReply = `BACKGROUNDOK${nonce}`;
      const backgroundMessage = `E2EBACKGROUND${nonce}. Reply exactly ${backgroundReply}.`;
      await caseWithVideo(driver, "03-mobile-send-while-backgrounded", async () => {
        await sendComposerMessage(driver!, backgroundMessage);
        await driver!.pressKeyCode(3);
        await appServer!.waitForUserText(threadId!, backgroundMessage, APP_SERVER_TIMEOUT_MS);
        await appServer!.waitForAgentText(threadId!, backgroundReply, APP_SERVER_TIMEOUT_MS);
        await driver!.activateApp(PACKAGE_NAME);
        await waitForVisibleTextContaining(driver!, backgroundReply);
      });

      const directReply = `DIRECTOK${nonce}`;
      const directMessage = `E2EDIRECT${nonce}. Reply exactly ${directReply}.`;
      await caseWithVideo(driver, "04-direct-app-server-while-backgrounded", async () => {
        await driver!.pressKeyCode(3);
        await appServer!.startTurn(threadId!, directMessage, `e2e-direct-${nonce.toLowerCase()}`);
        await appServer!.waitForAgentText(threadId!, directReply, APP_SERVER_TIMEOUT_MS);
        await driver!.activateApp(PACKAGE_NAME);
        await waitForVisibleTextContaining(driver!, directReply);
      });

      await caseWithVideo(driver, "05-process-death-recovery", async () => {
        await driver!.terminateApp(PACKAGE_NAME);
        await delay(1_000);
        await driver!.activateApp(PACKAGE_NAME);
        await waitForApplicationReady(driver!);
        await waitForRecoveredConversation(driver!, [mobileReply, backgroundReply, directReply]);
        const source = await driver!.getPageSource();
        if (source.includes("There was a problem loading the project")) {
          throw new Error("Expo project failed to load after process death");
        }
        const deviceCount = await readDeviceCount(companion.controlEndpoint, companion.tokenFile);
        if (deviceCount !== 1)
          throw new Error(`Expected one durable paired device after restart, found ${deviceCount}`);
      });
    }

    await grantShellScopeToOnlyDevice(companion.controlEndpoint, companion.tokenFile);
    const secondPairingLink = await createPairing(
      companion.controlEndpoint,
      companion.tokenFile,
      companionPort,
    );
    await caseWithVideo(driver, "06-v2-generation-and-saved-server", async () => {
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, "codewide://settings");
      await clickAccessibility(driver!, "Use V2 interface");
      await delay(1_500);
      await driver!.terminateApp(PACKAGE_NAME);
      await driver!.activateApp(PACKAGE_NAME);
      await waitForApplicationReady(driver!);
      await waitForVisibleTextContaining(driver!, "All saved servers");
      await clickAccessibility(driver!, "Open Saved server 1");
      await waitForVisibleTextContaining(driver!, "live");

      const baselineIds = new Set((await appServer!.listThreads()).map(({ id }) => id));
      const v2Reply = `V2FEATUREOK${nonce}`;
      const v2Message = `E2EV2${nonce}. Reply exactly ${v2Reply}.`;
      await clickAccessibility(driver!, "New thread");
      const workspace = await waitForAccessibility(driver!, "Workspace path");
      await workspace.setValue(REPO_ROOT);
      const firstMessage = await waitForAccessibility(driver!, "First message");
      await firstMessage.setValue(v2Message);
      const fault = await armCommandFault(companion.controlEndpoint, companion.tokenFile);
      observe("faultArmed", "companionPrivateControl", fault.state);
      const companionLog = path.join(artifactDir, "companion.log");
      const admissionCheckpoint = (await stat(companionLog)).size;
      await adb(device!, REPO_ROOT, ["logcat", "-c"]);
      await clickAccessibility(driver!, "Create thread");
      observe("uiActionDispatch", "appium", "completed");
      const durableOperationId = await waitForClientDurableCreate(
        device!,
        REPO_ROOT,
        UI_TIMEOUT_MS,
      );
      observe(
        "clientDurableCreate",
        "androidLogcatAfterSqliteCommit",
        "persisted",
        durableOperationId,
      );
      const held = await waitForCommandFault(
        companion.controlEndpoint,
        companion.tokenFile,
        fault.faultId,
        "nextLiveHeld",
        UI_TIMEOUT_MS,
      );
      if (held.operationId === undefined) {
        throw new Error("Companion fault reached nextLiveHeld without an operation id");
      }
      if (held.operationId !== durableOperationId) {
        throw new Error("Android durable create and Companion intercept operation ids differ");
      }
      observe("nextCommandIntercepted", "companionPrivateControl", "completed", held.operationId);
      observe("reinitializeSent", "companionPrivateControl", "completed", held.operationId);
      observe("nextLiveHeld", "companionPrivateControl", "completed", held.operationId);

      await driver!.terminateApp(PACKAGE_NAME);
      await delay(1_000);
      await driver!.activateApp(PACKAGE_NAME);
      await waitForApplicationReady(driver!);
      await waitForVisibleTextContaining(driver!, "All saved servers");
      await clickAccessibility(driver!, "Open Saved server 1");
      // The injected fault deliberately holds this recovered session before
      // Live. The server shell is still navigable, so verify the durable
      // correlation on the remounted route before releasing that boundary.
      await waitForAccessibility(driver!, "New thread");
      await clickAccessibility(driver!, "New thread");
      const remountedWorkspace = await waitForAccessibility(driver!, "Workspace path");
      const remountedMessage = await waitForAccessibility(driver!, "First message");
      await waitForVisibleTextContaining(driver!, "saved action is waiting for the server");
      if (!(await remountedWorkspace.isEnabled()) || !(await remountedMessage.isEnabled())) {
        throw new Error(
          "A recovered durable correlation incorrectly locked the fresh remounted draft",
        );
      }
      observe("v2ProcessDeathRecovery", "appium", "sameIdPendingRestored", held.operationId);

      const released = await releaseCommandFault(
        companion.controlEndpoint,
        companion.tokenFile,
        fault.faultId,
      );
      observe("nextLiveReleased", "companionPrivateControl", released.state, held.operationId);
      await waitForCompanionAdmission(
        companionLog,
        admissionCheckpoint,
        held.operationId,
        UI_TIMEOUT_MS,
      );
      observe("companionAdmission", "companionStructuredLog", "firstObserved", held.operationId);
      observe("appServerOraclePoll", "appServer", "startedAfterAdmission", held.operationId);
      threadId = await appServer!.findNewThreadWithUserText(
        baselineIds,
        v2Message,
        APP_SERVER_TIMEOUT_MS,
      );
      await appServer!.waitForAgentText(threadId, v2Reply, APP_SERVER_TIMEOUT_MS);
      await waitForTextHidden(driver!, "saved action is waiting for the server");
      await driver!.back();
      await waitForAccessibility(driver!, "New thread");
      // The real Observer may update unrelated user threads while the E2E
      // command runs, and several recent rows may still be untitled. Resolve
      // the created conversation by its authoritative marker through the UI
      // instead of assuming any catalog position or title is unique.
      await openProjectedThreadContaining(driver!, v2Reply, threadId);
      await waitForAccessibility(driver!, "Attachments");
      observe(
        "appServerOracleResult",
        "appServer",
        "authoritativeMutationObserved",
        held.operationId,
      );

      // The isolated E2E pairing is a real V2 device context, so this proves
      // the visible Voice control reaches the V2 Voice websocket and that a
      // user cancellation releases the native capture/session without relying
      // on a transcription result or any pre-existing user server.
      await clickAccessibility(driver!, "Start V2 voice input");
      await waitForAccessibility(driver!, "Cancel V2 voice input");
      await clickAccessibility(driver!, "Cancel V2 voice input");
      await waitForVisibleTextContaining(driver!, "Voice input cancelled.");
      observe("v2VoiceCancelled", "appium", "authoritativeSessionClosed");

      await clickAccessibility(driver!, "Attachments");
      await waitForVisibleTextContaining(driver!, "No attachments in this thread");
      await clickAccessibility(driver!, "Refresh attachments");
      await driver!.back();
      await waitForAccessibility(driver!, "Changes");

      await clickAccessibility(driver!, "Changes");
      await waitForVisibleTextContaining(driver!, "No file changes in this thread");
      await clickAccessibility(driver!, "Refresh changes");
      await driver!.back();
      await waitForAccessibility(driver!, "Agents");

      await clickAccessibility(driver!, "Agents");
      await waitForVisibleTextContaining(driver!, "No agent threads");
      await driver!.back();
      await waitForAccessibility(driver!, "Terminal");

      await clickAccessibility(driver!, "Terminal");
      await clickAccessibility(driver!, "Open terminal");
      const terminalInput = await waitForAccessibility(driver!, "Terminal input");
      const terminalMarker = `V2TERMINAL${nonce}`;
      await terminalInput.setValue(`printf ${terminalMarker}`);
      await driver!.pressKeyCode(66);
      await waitForVisibleTextContaining(driver!, terminalMarker);
      await driver!.back();
      await waitForAccessibility(driver!, "Attachments");
      await driver!.back();
      await waitForAccessibility(driver!, "Ports");

      await clickAccessibility(driver!, "Ports");
      await clickAccessibility(driver!, "Scan ports");
      await clickFirstAccessibilityExcept(driver!, new Set(["Scan ports"]));
      await waitForAccessibility(driver!, "Create secure tunnel");
      await clickAccessibility(driver!, "Create secure tunnel");
      await waitForAccessibility(driver!, "Close tunnel");
      await clickAccessibility(driver!, "Close tunnel");
      await waitForAccessibility(driver!, "Create secure tunnel");
      await driver!.back();
      await driver!.back();
      await waitForAccessibility(driver!, "Accounts");

      await clickAccessibility(driver!, "Accounts");
      await waitForAccessibilityHidden(driver!, "Server settings");
      await waitForVisibleTextContaining(driver!, "Accounts");
      await driver!.back();
      await waitForAccessibility(driver!, "Server settings");
      await clickAccessibility(driver!, "Server settings");
      await clickAccessibility(driver!, "Reconnect server");
      await driver!.back();
      await waitForVisibleTextContaining(driver!, "live");
      await driver!.back();
      await waitForAccessibility(driver!, "Add server");

      await clickAccessibility(driver!, "Add server");
      const pairingInput = await waitForAccessibility(driver!, "Pairing link");
      await pairingInput.setValue(secondPairingLink);
      await clickAccessibility(driver!, "Connect server");
      await waitForVisibleTextContaining(driver!, "live");

      // The second pairing link belongs solely to this run. Delete that
      // selected saved-server namespace and prove the original test-created
      // server remains available on the V2 catalog.
      await clickAccessibility(driver!, "Server settings");
      await clickAccessibility(driver!, "Delete saved server");
      await waitForAccessibility(driver!, "Confirm delete server");
      await clickAccessibility(driver!, "Confirm delete server");
      await waitForVisibleTextContaining(driver!, "All saved servers");
      await waitForAccessibility(driver!, "Open Saved server 1");
      await waitForAccessibilityHidden(driver!, "Open Saved server 2");
      observe("v2SavedServerDeleted", "appium", "selectedNamespacePurged");

      await delay(1_000);
      await assertCompanionAdmissionCount(companionLog, admissionCheckpoint, held.operationId, 1);
      observe(
        "finalCompanionAdmissionCount",
        "companionStructuredLog",
        "exactlyOnce",
        held.operationId,
      );
    });
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    if (driver !== null) {
      await driver.saveScreenshot(path.join(artifactDir, "failure.png")).catch(() => undefined);
      await writeFile(
        path.join(artifactDir, "failure-page.xml"),
        await driver.getPageSource().catch(() => ""),
        { mode: 0o600 },
      );
    }
  } finally {
    if (device !== null) {
      const logcat = await captureLogcat(device, REPO_ROOT).catch(() => "");
      await writeFile(path.join(artifactDir, "logcat.txt"), filterLogcat(logcat), { mode: 0o600 });
    }
    appServer?.close();
    if (driver !== null) await driver.deleteSession().catch(() => undefined);
    if (device !== null) {
      await adb(device, REPO_ROOT, ["shell", "pm", "clear", PACKAGE_NAME], {
        allowFailure: true,
      }).catch(() => undefined);
      for (const port of reversePorts)
        await removeReversePort(device, REPO_ROOT, port).catch(() => undefined);
    }
    for (const process of processes.reverse()) await process.stop();
    if (device?.emulatorProcess !== null && device?.emulatorProcess !== undefined) {
      await adb(device, REPO_ROOT, ["emu", "kill"], { allowFailure: true }).catch(() => undefined);
      await device.emulatorProcess.stop();
    }
    await removeRuntimeDir(runtimeDir);
  }

  const evidence: Evidence = {
    runId,
    passed: failure === null,
    deviceSerial: device?.serial ?? null,
    threadId,
    steps,
    observations,
    videos,
    failure: failure?.message ?? null,
  };
  const evidencePath = path.join(artifactDir, "evidence.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const reportPath = await writeE2eReport(artifactDir, evidence);
  process.stdout.write(
    `${JSON.stringify({
      passed: evidence.passed,
      artifact: path.relative(REPO_ROOT, evidencePath),
      report: path.relative(REPO_ROOT, reportPath),
      failure: evidence.failure,
    })}\n`,
  );
  if (failure !== null) throw failure;
}

function observe(stage: string, source: string, outcome: string, operationId?: string): void {
  observations.push({
    stage,
    source,
    elapsedMs: Math.round(performance.now() - startedAt),
    outcome,
    ...(operationId === undefined ? {} : { operationId }),
  });
}

async function startCompanion(
  runtimeDir: string,
  port: number,
): Promise<{
  process: ManagedProcess;
  controlEndpoint: string;
  tokenFile: string;
}> {
  return step("start isolated Companion", async () => {
    const companionBinary = path.join(REPO_ROOT, "target", "debug", "codewide-companion");
    const controlEndpoint = path.join(runtimeDir, "control.sock");
    const tokenFile = path.join(runtimeDir, "host.token");
    await runCommand(companionBinary, ["create-token", "--token-file", tokenFile], {
      cwd: REPO_ROOT,
    });
    const process = new ManagedProcess(
      companionBinary,
      [
        "serve",
        "--listen",
        `127.0.0.1:${port}`,
        "--control-endpoint",
        controlEndpoint,
        "--state",
        path.join(runtimeDir, "state.redb"),
        "--data-dir",
        path.join(runtimeDir, "data"),
        "--identity-dir",
        path.join(runtimeDir, "identity"),
        "--token-file",
        tokenFile,
        "--app-server-socket",
        appServerSocket(),
        "--codex-home",
        codexHome(),
        "--device-registry",
        path.join(runtimeDir, "devices.json"),
        "--enable-mutations",
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...processEnv(),
          RUST_LOG: processEnv().RUST_LOG?.trim() || "codewide_companion=debug,warn",
        },
        logPath: path.join(artifactDir, "companion.log"),
      },
    );
    await waitForFile(controlEndpoint, process, 30_000);
    await waitForTcpPort(port, process, 30_000);
    return { process, controlEndpoint, tokenFile };
  });
}

async function startMetro(port: number): Promise<ManagedProcess> {
  return step("start Metro", async () => {
    const process = new ManagedProcess(
      "pnpm",
      [
        "--filter",
        "@codewide/android",
        "exec",
        "expo",
        "start",
        "--dev-client",
        "--lan",
        "--clear",
        "--port",
        String(port),
      ],
      {
        cwd: REPO_ROOT,
        env: { ...processEnv(), CI: "1" },
        logPath: path.join(artifactDir, "metro.log"),
      },
    );
    await waitForTcpPort(port, process, 120_000);
    return process;
  });
}

async function startAppium(port: number, sdkRoot: string): Promise<ManagedProcess> {
  return step("start Appium", async () => {
    const process = new ManagedProcess(
      "pnpm",
      ["exec", "appium", "--port", String(port), "--base-path", "/", "--log-no-colors"],
      {
        cwd: REPO_ROOT,
        env: {
          ...processEnv(),
          APPIUM_HOME: appiumHome(),
          ANDROID_HOME: sdkRoot,
          ANDROID_SDK_ROOT: sdkRoot,
        },
        logPath: path.join(artifactDir, "appium.log"),
      },
    );
    await waitForHttpStatus(port, process, 60_000);
    return process;
  });
}

async function ensureAppiumDriver(): Promise<void> {
  await mkdir(appiumHome(), { recursive: true, mode: 0o700 });
  const env = { ...processEnv(), APPIUM_HOME: appiumHome() };
  const list = await runCommand(
    "pnpm",
    ["exec", "appium", "driver", "list", "--installed", "--json"],
    { cwd: REPO_ROOT, env },
  );
  let installedVersion: string | null = null;
  try {
    const parsed: unknown = JSON.parse(list.stdout);
    if (
      isRecord(parsed) &&
      isRecord(parsed.uiautomator2) &&
      typeof parsed.uiautomator2.version === "string"
    ) {
      installedVersion = parsed.uiautomator2.version;
    }
  } catch {
    throw new Error("Appium returned invalid installed-driver JSON");
  }
  if (installedVersion === APPIUM_DRIVER_VERSION) return;
  if (installedVersion !== null) {
    await runCommand("pnpm", ["exec", "appium", "driver", "uninstall", "uiautomator2"], {
      cwd: REPO_ROOT,
      env,
    });
  }
  await runCommand(
    "pnpm",
    [
      "exec",
      "appium",
      "driver",
      "install",
      "--source=npm",
      `appium-uiautomator2-driver@${APPIUM_DRIVER_VERSION}`,
    ],
    { cwd: REPO_ROOT, env, timeoutMs: 180_000 },
  );
}

async function createPairing(
  controlEndpoint: string,
  tokenFile: string,
  port: number,
): Promise<string> {
  return step("create one-time Companion pairing", async () => {
    const result = await runCommand(
      path.join(REPO_ROOT, "target/debug/codewide-companion"),
      ["pair", "--control-endpoint", controlEndpoint, "--token-file", tokenFile, "--json"],
      {
        cwd: REPO_ROOT,
        env: {
          ...processEnv(),
          // ADB reverse is the local outer carrier. The production security
          // boundary still runs inside it as pinned TLS 1.3 through /v1/e2ee-tunnel.
          CODEWIDE_PUBLIC_ENDPOINT: `ws://127.0.0.1:${port}/v1/sync`,
          CODEWIDE_SERVER_NAME: "CodeWide E2E",
        },
      },
    );
    const parsed: unknown = JSON.parse(result.stdout);
    if (!isRecord(parsed) || typeof parsed.pairingLink !== "string") {
      throw new Error("Companion did not return a pairing link");
    }
    return parsed.pairingLink;
  });
}

async function readDeviceCount(controlEndpoint: string, tokenFile: string): Promise<number> {
  const result = await runCommand(
    path.join(REPO_ROOT, "target/debug/codewide-companion"),
    ["devices", "--control-endpoint", controlEndpoint, "--token-file", tokenFile],
    { cwd: REPO_ROOT },
  );
  const parsed: unknown = JSON.parse(result.stdout);
  if (Array.isArray(parsed)) return parsed.length;
  if (isRecord(parsed) && Array.isArray(parsed.devices)) return parsed.devices.length;
  throw new Error("Companion returned an invalid device list");
}

async function grantShellScopeToOnlyDevice(
  controlEndpoint: string,
  tokenFile: string,
): Promise<void> {
  const control = ["--control-endpoint", controlEndpoint, "--token-file", tokenFile];
  const result = await runCommand(
    path.join(REPO_ROOT, "target/debug/codewide-companion"),
    ["devices", ...control],
    { cwd: REPO_ROOT },
  );
  const parsed: unknown = JSON.parse(result.stdout);
  const devices = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.devices)
      ? parsed.devices
      : null;
  if (devices?.length !== 1 || !isRecord(devices[0])) {
    throw new Error("Shell-scoped E2E requires exactly one paired device");
  }
  const deviceId = devices[0].id;
  const currentScopes = devices[0].scopes;
  if (
    typeof deviceId !== "string" ||
    !Array.isArray(currentScopes) ||
    !currentScopes.every((scope): scope is string => typeof scope === "string")
  ) {
    throw new Error("Companion returned an invalid paired device");
  }
  const scopes = [...new Set([...currentScopes, "shell.explicit"])];
  await step("grant explicit shell scope to E2E device", async () => {
    await runCommand(
      path.join(REPO_ROOT, "target/debug/codewide-companion"),
      ["scopes", deviceId, scopes.join(","), ...control],
      { cwd: REPO_ROOT },
    );
  });
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  process.stdout.write(`→ ${name}\n`);
  try {
    const value = await action();
    const durationMs = Date.now() - started;
    steps.push({ name, status: "passed", durationMs });
    process.stdout.write(`✓ ${name} (${formatDuration(durationMs)})\n`);
    return value;
  } catch (error) {
    const message = safeError(error);
    steps.push({ name, status: "failed", durationMs: Date.now() - started, error: message });
    process.stdout.write(`✗ ${name}: ${message}\n`);
    throw error;
  }
}

async function removeRuntimeDir(directory: string): Promise<void> {
  const expectedPrefix = path.join(os.tmpdir(), "codewide-android-e2e-");
  if (!directory.startsWith(expectedPrefix))
    throw new Error(`Refusing to remove unexpected runtime directory: ${directory}`);
  await rm(directory, { recursive: true, force: true });
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
}

function appServerSocket(): string {
  return (
    process.env.CODEWIDE_E2E_APP_SERVER_SOCKET?.trim() ||
    path.join(codexHome(), "app-server-control", "app-server-control.sock")
  );
}

function appiumHome(): string {
  return (
    process.env.CODEWIDE_E2E_APPIUM_HOME?.trim() ||
    path.join(os.homedir(), ".cache", "codewide", "appium")
  );
}

function processEnv(): NodeJS.ProcessEnv {
  return process.env;
}

function filterLogcat(value: string): string {
  return value
    .split("\n")
    .filter(
      (line) =>
        line.includes(PACKAGE_NAME) ||
        line.includes("CodeWide") ||
        line.includes("CodexConnectionService") ||
        line.includes("DevLauncher") ||
        line.includes("ReactNativeJS") ||
        line.includes("okhttp") ||
        line.includes("System.err"),
    )
    .join("\n")
    .slice(-2_000_000);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/[A-Za-z0-9_-]{48,}/g, "[redacted]").slice(0, 2_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}
