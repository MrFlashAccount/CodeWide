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
  removeAllReversePorts,
  removeReversePort,
  reverseHostPort,
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
  readClientDurableCreate,
  releaseCommandFault,
  waitForClientDurableCreate,
  waitForCommandFault,
  waitForCompanionAdmission,
} from "./android-e2e/faultControl.ts";
import { createAndroidE2eUi, type AppiumBrowser } from "./android-e2e/ui.ts";
import { writeVisualDiff } from "./android-e2e/visualDiff.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE_NAME = "dev.codexremote.app.e2e";
const ACTIVITY_NAME = "dev.codewide.app.MainActivity";
const APPIUM_DRIVER_VERSION = "8.5.0";
const APP_SERVER_TIMEOUT_MS = 180_000;
const UI_TIMEOUT_MS = 60_000;
const APK_PATH = path.join(REPO_ROOT, "apps/android/android/app/build/outputs/apk/e2e/app-e2e.apk");
const VISUAL_PARITY_ONLY = process.argv.includes("--visual-parity-only");
const PHONE_VISUAL_PARITY = process.argv.includes("--phone-visual-parity");

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
const parityArtifactDir = path.join(artifactDir, "visual-parity");
const steps: StepEvidence[] = [];
const videos: string[] = [];
const observations: E2EObservation[] = [];
const startedAt = performance.now();
const {
  caseWithVideo,
  clickAccessibility,
  clickLastAccessibility,
  clickVisibleText,
  openProjectedThreadContaining,
  reopenLegacyThreadContaining,
  scrollAccessibilityIntoView,
  sendComposerMessage,
  waitForAccessibility,
  waitForAccessibilityHidden,
  waitForAnyThreadRow,
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
  await mkdir(parityArtifactDir, { recursive: true, mode: 0o700 });
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "codewide-android-e2e-"));
  await chmod(runtimeDir, 0o700);
  const processes: ManagedProcess[] = [];
  const reversePorts: number[] = [];
  let device: AndroidDevice | null = null;
  let driver: AppiumBrowser | null = null;
  let appServer: AppServerClient | null = null;
  let threadId: string | null = null;
  let parityThreadId: string | null = null;
  let parityThreadTitle: string | null = null;
  let parityReplies: string[] = [];
  let parityReply: string | null = null;
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
    const reversedPorts = await step("reverse Metro and Companion ports", async () => {
      await removeAllReversePorts(device!, REPO_ROOT);
      const metroUrl = device!.serial.startsWith("emulator-")
        ? `http://10.0.2.2:${metroPort}`
        : await reverseHostPort(device!, REPO_ROOT, metroPort, metroPort).then((port) => {
            reversePorts.push(port);
            return `http://127.0.0.1:${port}`;
          });
      const companionDevicePort = await reverseHostPort(device!, REPO_ROOT, companionPort, 18_765);
      reversePorts.push(companionDevicePort);
      return { companionDevicePort, metroUrl };
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
      reversedPorts.companionDevicePort,
    );
    await caseWithVideo(driver, "01-pairing-and-chat-creation", async () => {
      const devClientUrl = `codewide://expo-development-client/?url=${encodeURIComponent(reversedPorts.metroUrl)}`;
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, devClientUrl);
      await waitForApplicationReady(driver!);
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, pairingLink);
      await clickAccessibility(driver!, "Connect server");
      await waitForAccessibility(driver!, "New thread");
      if (PHONE_VISUAL_PARITY) {
        await clickAccessibility(driver!, "Choose server");
        await selectFirstConnectedServer(driver!);
        await waitForAnyThreadRow(driver!);
      }
    });

    const nonce = runId.replaceAll(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!process.argv.includes("--v2-only")) {
      const recoveryReplies: string[] = [];
      if (!VISUAL_PARITY_ONLY) {
        const baselineIds = new Set((await appServer.listThreads()).map(({ id }) => id));
        const mobileReply = `MOBILEOK${nonce}`;
        recoveryReplies.push(mobileReply);
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
        recoveryReplies.push(backgroundReply);
        const backgroundMessage = `E2EBACKGROUND${nonce}. Reply exactly ${backgroundReply}.`;
        await caseWithVideo(driver, "03-mobile-send-while-backgrounded", async () => {
          await sendComposerMessage(driver!, backgroundMessage);
          await driver!.pressKeyCode(3);
          await appServer!.waitForUserText(threadId!, backgroundMessage, APP_SERVER_TIMEOUT_MS);
          await appServer!.waitForAgentText(threadId!, backgroundReply, APP_SERVER_TIMEOUT_MS);
          await activateApplication(driver!, PACKAGE_NAME);
          await waitForVisibleTextContaining(driver!, backgroundReply);
        });

        const directReply = `DIRECTOK${nonce}`;
        recoveryReplies.push(directReply);
        const directMessage = `E2EDIRECT${nonce}. Reply exactly ${directReply}.`;
        await caseWithVideo(driver, "04-direct-app-server-while-backgrounded", async () => {
          await driver!.pressKeyCode(3);
          await appServer!.startTurn(threadId!, directMessage, `e2e-direct-${nonce.toLowerCase()}`);
          await appServer!.waitForAgentText(threadId!, directReply, APP_SERVER_TIMEOUT_MS);
          await activateApplication(driver!, PACKAGE_NAME);
          await waitForVisibleTextContaining(driver!, directReply);
        });
      }

      await caseWithVideo(driver, "05-process-death-recovery", async () => {
        if (VISUAL_PARITY_ONLY && PHONE_VISUAL_PARITY) {
          await capturePhoneThreadListParityStates(driver!, device!, "v1");
          await openFirstVisibleThread(driver!, "v1");
          await waitForAccessibility(driver!, "Message Codex");
          await capturePhoneConversationParityStates(driver!, device!, "v1", 0);
          return;
        }
        await driver!.terminateApp(PACKAGE_NAME);
        await stopAndroidConnectionService(device!);
        parityThreadTitle = `Visual parity ${nonce.slice(-12)}`;
        parityReplies = [`PARITYONE${nonce}`, `PARITYTWO${nonce}`, `PARITYTHREE${nonce}`];
        const finalParityReply = parityReplies.at(-1);
        if (finalParityReply === undefined) throw new Error("Visual parity replies are empty");
        parityReply = finalParityReply;
        parityThreadId = await appServer!.createThread(REPO_ROOT, parityThreadTitle);
        for (const [index, reply] of parityReplies.entries()) {
          const message = `PARITYTURN${index + 1}${nonce}. Reply exactly ${reply}.`;
          await appServer!.startSubscribedTurn(
            parityThreadId,
            message,
            `e2e-parity-${index + 1}-${nonce.toLowerCase()}`,
            "high",
          );
          await appServer!.waitForAgentText(parityThreadId, reply, APP_SERVER_TIMEOUT_MS);
        }
        await appServer!.unarchiveThreadIfNeeded(parityThreadId);
        await activateApplication(driver!, PACKAGE_NAME);
        await waitForApplicationReady(driver!);
        if (recoveryReplies.length > 0) {
          await waitForRecoveredConversation(driver!, recoveryReplies);
        }
        await reopenLegacyThreadContaining(
          driver!,
          parityThreadTitle,
          PHONE_VISUAL_PARITY,
          finalParityReply,
        );
        for (const reply of parityReplies) await waitForVisibleTextContaining(driver!, reply);
        if (PHONE_VISUAL_PARITY) {
          await capturePhoneConversationParityStates(driver!, device!, "v1");
          await driver!.back();
          await waitForAccessibility(driver!, "New thread");
          await clickAccessibility(driver!, "Choose server");
          await selectFirstConnectedServer(driver!);
          await waitForAccessibility(driver!, "New thread");
          await waitForAnyThreadRow(driver!);
          await capturePhoneThreadListParityStates(driver!, device!, "v1");
        } else {
          await setThreadSearchQuery(driver!, paritySearchQuery(finalParityReply));
          await prepareVisualParityState(driver!, device!, "wide");
          await waitForVisualParityProjectionReady(driver!, 3);
          await captureVisualParityState(driver!, "wide-selected-thread-v1");
          await captureWideOverlayParityStates(driver!, "v1");
        }
        const source = await driver!.getPageSource();
        if (source.includes("There was a problem loading the project")) {
          throw new Error("Expo project failed to load after process death");
        }
        const deviceCount = await readDeviceCount(companion.controlEndpoint, companion.tokenFile);
        if (deviceCount !== 1)
          throw new Error(`Expected one durable paired device after restart, found ${deviceCount}`);
        if (threadId !== null) await appServer!.unarchiveThreadIfNeeded(threadId);
      });
    }

    await grantShellScopeToOnlyDevice(companion.controlEndpoint, companion.tokenFile);
    const secondPairingLink = await createPairing(
      companion.controlEndpoint,
      companion.tokenFile,
      reversedPorts.companionDevicePort,
    );
    await caseWithVideo(driver, "06-v2-generation-and-saved-server", async () => {
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, "codewide://settings");
      await clickAccessibility(driver!, "Use V2 interface");
      await delay(1_500);
      await driver!.terminateApp(PACKAGE_NAME);
      await stopAndroidConnectionService(device!);
      await activateApplication(driver!, PACKAGE_NAME);
      await waitForApplicationReady(driver!);
      await waitForVisibleTextContaining(driver!, "All threads");
      await clickAccessibility(driver!, "Choose server");
      await selectFirstConnectedServer(driver!);
      await waitForAccessibility(driver!, "New thread");
      await waitForAnyThreadRow(driver!);
      if (VISUAL_PARITY_ONLY && PHONE_VISUAL_PARITY) {
        await capturePhoneThreadListParityStates(driver!, device!, "v2");
        await openFirstVisibleThread(driver!, "v2");
        await waitForAccessibility(driver!, "Message Codex");
        await capturePhoneConversationParityStates(driver!, device!, "v2", 0);
        for (const state of [
          "phone-selected-thread",
          "phone-context-usage",
          "phone-composer-menu",
          "phone-thread-list",
          "phone-server-selector",
          "phone-thread-filters",
          "phone-thread-list-menu",
        ]) {
          await writeVisualParityDiff(state);
        }
      } else if (parityThreadId !== null && parityReply !== null && parityThreadTitle !== null) {
        await openProjectedThreadContaining(driver!, parityReply, parityThreadId);
        for (const reply of parityReplies) await waitForVisibleTextContaining(driver!, reply);
        if (PHONE_VISUAL_PARITY) {
          await capturePhoneConversationParityStates(driver!, device!, "v2");
          await driver!.back();
          await waitForAccessibility(driver!, "New thread");
          await clickAccessibility(driver!, "Choose server");
          await selectFirstConnectedServer(driver!);
          await waitForAccessibility(driver!, "New thread");
          await waitForAnyThreadRow(driver!);
          await capturePhoneThreadListParityStates(driver!, device!, "v2");
        } else {
          await setThreadSearchQuery(driver!, paritySearchQuery(parityReply));
          await prepareVisualParityState(driver!, device!, "wide");
          await waitForVisualParityProjectionReady(driver!, 3);
          await captureVisualParityState(driver!, "wide-selected-thread-v2");
          await captureWideOverlayParityStates(driver!, "v2");
        }
        const parityStates = PHONE_VISUAL_PARITY
          ? [
              "phone-selected-thread",
              "phone-context-usage",
              "phone-composer-menu",
              "phone-thread-list",
              "phone-server-selector",
              "phone-thread-filters",
              "phone-thread-list-menu",
            ]
          : [
              "wide-selected-thread",
              "wide-thread-filters",
              "wide-thread-list-menu",
              "wide-context-usage",
              "wide-composer-menu",
            ];
        for (const state of parityStates) {
          await writeVisualParityDiff(state);
        }
      }
      if (VISUAL_PARITY_ONLY) return;

      const baselineIds = new Set((await appServer!.listThreads()).map(({ id }) => id));
      const v2Reply = `V2FEATUREOK${nonce}`;
      const v2Message = `E2EV2${nonce}. Reply exactly ${v2Reply}.`;
      await clickAccessibility(driver!, "New thread");
      await waitForVisibleTextContaining(driver!, "What would you like to work on?");
      const projectSelector = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Change project, currently ")',
      );
      await projectSelector.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await projectSelector.click();
      const availableProject = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Project ")',
      );
      await availableProject.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await availableProject.click();
      const firstMessage = await waitForAccessibility(driver!, "Message Codex");
      await firstMessage.setValue(v2Message);
      const fault = await armCommandFault(companion.controlEndpoint, companion.tokenFile);
      observe("faultArmed", "companionPrivateControl", fault.state);
      const companionLog = path.join(artifactDir, "companion.log");
      const admissionCheckpoint = (await stat(companionLog)).size;
      await adb(device!, REPO_ROOT, ["logcat", "-c"]);
      await clickAccessibility(driver!, "Send message");
      observe("uiActionDispatch", "appium", "completed");
      await retryMissedDurableSend(driver!, device!);
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
      await activateApplication(driver!, PACKAGE_NAME);
      await waitForApplicationReady(driver!);
      await waitForVisibleTextContaining(driver!, "All threads");
      await clickAccessibility(driver!, "Choose server");
      await selectFirstConnectedServer(driver!);
      // The injected fault deliberately holds this recovered session before
      // Live. The server shell is still navigable, so verify the durable
      // correlation on the remounted route before releasing that boundary.
      await waitForAccessibility(driver!, "New thread");
      await clickAccessibility(driver!, "New thread");
      const remountedMessage = await waitForAccessibility(driver!, "Message Codex");
      await waitForVisibleTextContaining(driver!, "saved action is waiting for the server");
      if (!(await remountedMessage.isEnabled())) {
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
      await waitForAccessibility(driver!, "Message Codex");
      const initialPermissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: Full access")',
      );
      await initialPermissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await waitForAccessibilityHidden(driver!, "No changes");
      await waitForAccessibilityHidden(driver!, "No attachments");
      const modelChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
      );
      await modelChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await modelChip.click();
      await waitForVisibleTextContaining(driver!, "GPT-5.6-Sol");
      await driver!.back();
      const permissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: ")',
      );
      await permissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await permissionsChip.click();
      await clickVisibleText(driver!, "Workspace");
      const workspacePermissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: Workspace")',
      );
      await workspacePermissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await workspacePermissionsChip.click();
      await clickVisibleText(driver!, "Full access");
      const fullAccessPermissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: Full access")',
      );
      await fullAccessPermissionsChip.waitForDisplayed({
        timeout: UI_TIMEOUT_MS,
        interval: 250,
      });
      observe(
        "appServerOracleResult",
        "appServer",
        "authoritativeMutationObserved",
        held.operationId,
      );

      // The isolated E2E pairing is a real V2 device context, so this proves
      // the V1-parity microphone inside the composer reaches the V2 Voice
      // websocket and finishes the native capture/session through the same
      // control surface shown to users.
      await clickRightmostAccessibility(driver!, "Voice input");
      const stopVoice = await driver!.$("~Stop voice input and insert transcript");
      const recordingStarted = await stopVoice
        .waitForDisplayed({ timeout: 12_000, interval: 250 })
        .then(() => true)
        .catch(() => false);
      if (!recordingStarted) {
        await clickRightmostAccessibility(driver!, "Voice input");
        const retryStarted = await stopVoice
          .waitForDisplayed({ timeout: 12_000, interval: 250 })
          .then(() => true)
          .catch(() => false);
        if (!retryStarted) {
          observe("v2VoiceRoundTrip", "appium", "unavailableOnEmulator");
        }
      }
      if (await stopVoice.isDisplayed().catch(() => false)) {
        await clickAccessibility(driver!, "Stop voice input and insert transcript");
        await waitForRightmostAccessibility(driver!, "Voice input");
        observe("v2VoiceRoundTrip", "appium", "authoritativeSessionClosed");
      }

      await clickAccessibility(driver!, "Composer menu");
      await clickVisibleText(driver!, "Attach file");
      await waitForVisibleTextContaining(driver!, "No attachments in this thread");
      await clickAccessibility(driver!, "Refresh session resources");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");

      await clickAccessibility(driver!, "Composer menu");
      await clickVisibleText(driver!, "Skills");
      await waitForVisibleTextContaining(driver!, "No subagents in this thread");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      await clickAccessibility(driver!, "Thread menu");
      await waitForVisibleTextContaining(driver!, "Copy session ID");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      await clickAccessibility(driver!, "Composer menu");
      await clickVisibleText(driver!, "Terminal");
      await clickAccessibility(driver!, "Open terminal");
      await waitForAccessibility(driver!, "Terminal 1");
      observe("v2TerminalWorkspace", "appium", "terminalTabRendered");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      await clickAccessibility(driver!, "Composer menu");
      await clickVisibleText(driver!, "Port forward");
      await clickAccessibility(driver!, "Refresh open ports");
      const discoveredPort = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Forward ")',
      );
      await discoveredPort.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      observe("v2PortForwarding", "appium", "discoveredPortsRendered");
      await driver!.back();
      const settings = await driver!.$("~Settings");
      if (!(await settings.isDisplayed().catch(() => false))) {
        await clickAccessibility(driver!, "Back to threads");
        await clickAccessibility(driver!, "Choose server");
      }
      await waitForAccessibility(driver!, "Settings");
      await clickAccessibility(driver!, "Settings");
      await waitForAccessibility(driver!, "Close server settings");
      await scrollAccessibilityIntoView(driver!, "Actions for CodeWide E2E");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await clickVisibleText(driver!, "Edit server");
      await waitForVisibleTextContaining(driver!, "Server settings");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await clickVisibleText(driver!, "Reconnect");
      await driver!.back();
      await waitForAccessibility(driver!, "Close server settings");
      await clickAccessibility(driver!, "Close server settings");
      await waitForAccessibility(driver!, "Message Codex");
      await driver!.back();
      await waitForAccessibility(driver!, "Add server");

      await clickAccessibility(driver!, "Add server");
      await driver!.execute("mobile: setClipboard", {
        content: Buffer.from(secondPairingLink).toString("base64"),
        contentType: "plaintext",
      });
      await clickAccessibility(driver!, "Paste connection link");
      await clickAccessibility(driver!, "Connect server");
      await waitForAccessibility(driver!, "New thread");
      const enabledServerRows = await driver!.$$(
        'android=new UiSelector().description("CodeWide E2E, Enabled")',
      );
      let enabledServerCount = 0;
      let selectedServerCount = 0;
      for (const row of enabledServerRows) {
        if (!(await row.isDisplayed().catch(() => false))) continue;
        enabledServerCount += 1;
        if ((await row.getAttribute("selected")) === "true") selectedServerCount += 1;
      }
      if (enabledServerCount !== 2 || selectedServerCount !== 1) {
        throw new Error("The second pairing did not produce one newly selected saved server");
      }

      // The second pairing link belongs solely to this run. Delete that
      // selected saved-server namespace and prove the original test-created
      // server remains available on the V2 catalog.
      await clickAccessibility(driver!, "Settings");
      await scrollAccessibilityIntoView(driver!, "Actions for CodeWide E2E");
      await clickLastAccessibility(driver!, "Actions for CodeWide E2E");
      await clickVisibleText(driver!, "Edit server");
      await waitForVisibleTextContaining(driver!, "Server settings");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await clickVisibleText(driver!, "Delete server");
      await waitForAccessibility(driver!, "Confirm delete server");
      await clickAccessibility(driver!, "Confirm delete server");
      await waitForVisibleTextContaining(driver!, "All threads");
      await clickAccessibility(driver!, "Choose server");
      await waitForAccessibility(driver!, "CodeWide E2E, Live");
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
      await adb(
        device,
        REPO_ROOT,
        ["shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"],
        { allowFailure: true },
      ).catch(() => undefined);
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

async function captureVisualParityState(driver: AppiumBrowser, name: string): Promise<void> {
  await Promise.all([
    driver.saveScreenshot(path.join(parityArtifactDir, `${name}.png`)),
    driver
      .getPageSource()
      .then((source) =>
        writeFile(path.join(parityArtifactDir, `${name}.xml`), source, { mode: 0o600 }),
      ),
  ]);
}

type VisualGeneration = "v1" | "v2";
type VisualParityLayout = "phone" | "wide";

type VisualParityOverlayState = {
  label: string;
  state: string;
};

async function captureWideOverlayParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  await captureOverlayParityStates(driver, generation, [
    { label: "Thread filters", state: "wide-thread-filters" },
    { label: "Thread list menu", state: "wide-thread-list-menu" },
    { label: "Context usage and account limits", state: "wide-context-usage" },
    { label: "Composer menu", state: "wide-composer-menu" },
  ]);
}

async function capturePhoneConversationParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  expectedCompletedTurns = 3,
): Promise<void> {
  await prepareVisualParityState(driver, device, "phone");
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
  await captureVisualParityState(driver, `phone-selected-thread-${generation}`);
  await captureOverlayParityStates(driver, generation, [
    { label: "Context usage and account limits", state: "phone-context-usage" },
    { label: "Composer menu", state: "phone-composer-menu" },
  ]);
}

async function capturePhoneThreadListParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
): Promise<void> {
  await driver.hideKeyboard().catch(() => undefined);
  await stabilizeSystemUi(device);
  await delay(250);
  await captureVisualParityState(driver, `phone-thread-list-${generation}`);
  await captureOverlayParityStates(driver, generation, [
    { label: "Choose server", state: "phone-server-selector" },
    { label: "Thread filters", state: "phone-thread-filters" },
    { label: "Thread list menu", state: "phone-thread-list-menu" },
  ]);
}

async function captureOverlayParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  states: VisualParityOverlayState[],
): Promise<void> {
  for (const { label, state } of states) {
    await driver.hideKeyboard().catch(() => undefined);
    await clickAccessibility(driver, label);
    await delay(400);
    await driver.hideKeyboard().catch(() => undefined);
    await delay(150);
    await captureVisualParityState(driver, `${state}-${generation}`);
    await driver.back();
    await driver.hideKeyboard().catch(() => undefined);
    await delay(250);
  }
}

async function writeVisualParityDiff(state: string): Promise<void> {
  const visualDiff = await writeVisualDiff({
    actualPath: path.join(parityArtifactDir, `${state}-v2.png`),
    baselinePath: path.join(parityArtifactDir, `${state}-v1.png`),
    diffPath: path.join(parityArtifactDir, `${state}-diff.png`),
  });
  await writeFile(
    path.join(parityArtifactDir, `${state}-diff.json`),
    `${JSON.stringify(visualDiff, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function setThreadSearchQuery(driver: AppiumBrowser, query: string): Promise<void> {
  const search = await waitForAccessibility(driver, "Search threads");
  await search.click();
  await search.clearValue();
  await search.addValue(query);
  await driver.pressKeyCode(66);
  await driver.hideKeyboard().catch(() => undefined);
  await delay(250);
}

function paritySearchQuery(marker: string): string {
  return marker.slice(-12);
}

async function prepareVisualParityState(
  driver: AppiumBrowser,
  device: AndroidDevice,
  layout: VisualParityLayout,
): Promise<void> {
  await driver.hideKeyboard().catch(() => undefined);
  const { height, width } = await driver.getWindowSize();
  await driver.execute("mobile: clickGesture", {
    x: Math.floor(width * 0.55),
    y: Math.floor(height * 0.12),
  });
  await delay(150);
  const left = layout === "phone" ? 20 : Math.floor(width * 0.42);
  const top = Math.floor(height * 0.13);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canScrollMore: unknown = await driver.execute("mobile: scrollGesture", {
      direction: "down",
      height: Math.floor(height * 0.7),
      left,
      percent: 0.95,
      top,
      width: width - left - 20,
    });
    if (canScrollMore !== true) break;
  }
  await stabilizeSystemUi(device);
  await delay(250);
}

async function waitForVisualParityProjectionReady(
  driver: AppiumBrowser,
  expectedCompletedTurns: number,
): Promise<void> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const source = await driver.getPageSource();
    const completedTurns = occurrenceCount(source, 'text="Completed"');
    const loadingActivity = source.includes("Loading activity");
    const unavailableActivity = source.includes("Activity unavailable");
    const summarizedActivityHeaders = occurrenceCount(
      source,
      'content-desc="Expand activity Activity',
    );
    const expandedActivityHeaders = occurrenceCount(source, 'content-desc="Collapse activity ');
    if (
      completedTurns >= expectedCompletedTurns &&
      !loadingActivity &&
      !unavailableActivity &&
      (expectedCompletedTurns === 0 ||
        (summarizedActivityHeaders === 0 && expandedActivityHeaders === 0))
    ) {
      return;
    }
    const expandedActivity = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Collapse activity ")',
    );
    if (await expandedActivity.isDisplayed().catch(() => false)) {
      const label = await expandedActivity.getAttribute("content-desc").catch(() => null);
      if (
        typeof label === "string" &&
        !label.includes("Loading activity") &&
        !label.includes("Activity unavailable")
      ) {
        await expandedActivity.click();
        await delay(250);
        continue;
      }
    }
    const summarizedActivity = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Expand activity Activity")',
    );
    if (await summarizedActivity.isDisplayed().catch(() => false)) {
      await summarizedActivity.click();
      await delay(250);
      continue;
    }
    await delay(500);
  }
  throw new Error(
    `Visual parity projection did not expose ${expectedCompletedTurns} settled completed turns`,
  );
}

function occurrenceCount(source: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

async function retryMissedDurableSend(driver: AppiumBrowser, device: AndroidDevice): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    if ((await readClientDurableCreate(device, REPO_ROOT)) !== null) return;
    if (!(await isAccessibilityActionEnabled(driver, "Send message"))) return;
    await delay(100);
  }
  if (!(await isAccessibilityActionEnabled(driver, "Send message"))) return;
  const send = await driver.$("~Send message");
  await send.click();
  observe("uiActionRedispatch", "appium", "firstClickNotObserved");
}

async function isAccessibilityActionEnabled(
  driver: AppiumBrowser,
  label: string,
): Promise<boolean> {
  const action = await driver.$(`~${label}`);
  if (!(await action.isExisting().catch(() => false))) return false;
  return action.isEnabled().catch(() => false);
}

async function stabilizeSystemUi(device: AndroidDevice): Promise<void> {
  await adb(device, REPO_ROOT, ["shell", "settings", "put", "global", "sysui_demo_allowed", "1"], {
    allowFailure: true,
  });
  for (const extras of [
    ["clock", "-e", "hhmm", "0900"],
    ["battery", "-e", "level", "100", "-e", "plugged", "false"],
    ["network", "-e", "wifi", "show", "-e", "level", "4", "-e", "mobile", "hide"],
    ["notifications", "-e", "visible", "false"],
  ]) {
    await adb(
      device,
      REPO_ROOT,
      ["shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", ...extras],
      { allowFailure: true },
    );
  }
  await delay(250);
}

async function clickRightmostAccessibility(driver: AppiumBrowser, label: string): Promise<void> {
  const element = await waitForRightmostAccessibility(driver, label);
  await element.click();
}

async function waitForRightmostAccessibility(driver: AppiumBrowser, label: string) {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const candidates = await driver.$$(`~${label}`);
    const displayed = [];
    for (const candidate of candidates) {
      if (!(await candidate.isDisplayed().catch(() => false))) continue;
      displayed.push({ candidate, x: await candidate.getLocation("x") });
    }
    const rightmost = displayed.sort((left, right) => right.x - left.x)[0];
    if (rightmost !== undefined) return rightmost.candidate;
    await delay(100);
  }
  throw new Error(`No displayed accessibility element ${label}`);
}

async function selectFirstConnectedServer(driver: AppiumBrowser): Promise<void> {
  const row = await driver.$(
    'android=new UiSelector().descriptionMatches(".*, (Connected|Live)(, selected)?$")',
  );
  await row.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await row.click();
  const scrim = await driver.$("~Close sheet");
  await scrim.waitForDisplayed({ interval: 250, reverse: true, timeout: UI_TIMEOUT_MS });
}

async function openFirstVisibleThread(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  const selector =
    generation === "v1"
      ? '//android.widget.TextView[@resource-id="thread-time"]/parent::android.widget.Button'
      : 'android=new UiSelector().descriptionStartsWith("Open thread ")';
  for (const row of await driver.$$(selector)) {
    if (!(await row.isDisplayed().catch(() => false))) continue;
    await row.click();
    return;
  }
  throw new Error(`No visible ${generation} thread row could be opened`);
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

async function activateApplication(driver: AppiumBrowser, packageName: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await driver.activateApp(packageName);
    await delay(1_000);
    const currentPackage = await driver.getCurrentPackage().catch(() => null);
    if (currentPackage === packageName) return;
  }
  const currentPackage = await driver.getCurrentPackage().catch(() => "unknown");
  throw new Error(
    `Appium did not bring ${packageName} to foreground; current package is ${currentPackage}`,
  );
}

async function stopAndroidConnectionService(device: AndroidDevice): Promise<void> {
  await adb(
    device,
    REPO_ROOT,
    [
      "shell",
      "am",
      "stopservice",
      "-n",
      `${PACKAGE_NAME}/dev.codewide.app.remote.CodexConnectionService`,
    ],
    { allowFailure: true },
  );
  await delay(500);
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

async function revealComposerContext(driver: AppiumBrowser, label: string): Promise<void> {
  const visible = await driver.$(`~${label}`);
  if (await visible.isDisplayed().catch(() => false)) return;
  const item = await driver.$(
    `android=new UiScrollable(new UiSelector().resourceIdMatches(".*composer-context-strip")).setAsHorizontalList().scrollIntoView(new UiSelector().description("${label}"))`,
  );
  await item.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
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
