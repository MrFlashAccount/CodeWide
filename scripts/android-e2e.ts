import { randomUUID } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { remote } from "webdriverio";

import { AppServerClient } from "./android-e2e/appServerClient.ts";
import {
  captureNewThreadFailureParity,
  capturePairingFailureParity,
  capturePendingActionParity,
  captureSavedServerFailureParity,
  type SurfaceFaultControl,
} from "./android-e2e/actionFailureParity.ts";
import { captureBootParityStates } from "./android-e2e/bootParity.ts";
import {
  captureConversationLifecycleParity,
  captureRetainedConversationParity,
  createConversationLifecycleParityFixture,
  type ConversationLifecycleParityFixture,
  type ConversationLifecycleThread,
} from "./android-e2e/conversationLifecycleParity.ts";
import {
  acquireAndroidDevice,
  adb,
  captureLogcat,
  installFreshApp,
  openDeepLink,
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
  captureDisabledComposerMenuParity,
  captureDraftParity,
  captureInputParity,
  capturePaginationParity,
  captureRequestParity,
  type RequestDraftGeneration,
  type RequestDraftLayout,
} from "./android-e2e/requestDraftParity.ts";
import {
  captureAttachmentResourceParity,
  captureAttachmentAndChangesStateParity,
  captureBoundedTunnelPolicy,
  captureDiscoveredPortParity,
  captureEmptyAttachmentPolicy,
  capturePortLoadingAndErrorParity,
  captureTerminalFoldParity,
  captureTerminalLifecycleParity,
  captureTerminalLoadingParity,
  createResourceParityFixture,
  type ResourceParityFixture,
} from "./android-e2e/resourceParity.ts";
import {
  computeSourceFingerprint,
  requireStableSourceFingerprint,
} from "./android-e2e/sourceFingerprint.ts";
import {
  captureThreadRowParityStates,
  cleanupThreadRowParityFixture,
  createThreadRowParityFixture,
  type ThreadRowParityFaultControl,
  type ThreadRowParityFixture,
} from "./android-e2e/threadRowParity.ts";
import {
  captureEmptyCatalogNavigationParity,
  captureMultipleServerRailParity,
  captureServerStatusTransitionParity,
  captureServerStatusParity,
  captureZeroServerNavigationParity,
  setAndroidNetworkOffline,
  startEmptyServerStateFixture,
} from "./android-e2e/serverStateParity.ts";
import {
  armCommandFault,
  assertCompanionAdmissionCount,
  readClientDurableCreate,
  releaseCommandFault,
  waitForClientDurableCreate,
  waitForCommandFault,
  waitForCompanionAdmission,
} from "./android-e2e/faultControl.ts";
import {
  assertInteractionInventoryCoverage,
  capturePressedInteractionInventory,
  collectInteractionInventoryAliases,
} from "./android-e2e/interactionInventoryParity.ts";
import {
  ANDROID_E2E_TARGETS,
  sha256File,
  type AndroidE2eCapturePosture,
  type AndroidE2eCaptureProvenance,
  type AndroidE2eShardManifest,
  type AndroidE2eTargetFamily,
} from "./android-e2e/mergedEvidence.ts";
import { createAndroidE2eUi, type AppiumBrowser } from "./android-e2e/ui.ts";
import { readEdgeLuminance, writeVisualDiff } from "./android-e2e/visualDiff.ts";
import {
  captureThreadSearchVoiceParity,
  captureVoiceFaultParity,
} from "./android-e2e/voiceFaultParity.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE_NAME = "dev.codexremote.app.e2e";
const ACTIVITY_NAME = "dev.codewide.app.MainActivity";
const APPIUM_DRIVER_VERSION = "8.5.0";
const APP_SERVER_TIMEOUT_MS = 180_000;
const UI_TIMEOUT_MS = 60_000;
const APK_PATH = path.join(REPO_ROOT, "apps/android/android/app/build/outputs/apk/e2e/app-e2e.apk");
const COMPANION_PATH = path.join(REPO_ROOT, "target/debug/codewide-companion");
const VISUAL_PARITY_ONLY = process.argv.includes("--visual-parity-only");
const PHONE_VISUAL_PARITY = process.argv.includes("--phone-visual-parity");
const TARGET_FAMILY = readTargetFamilyEnvironment();
const EXPECTED_APK_SHA256 = process.env.CODEWIDE_E2E_EXPECTED_APK_SHA256?.trim() ?? null;
const EXPECTED_COMPANION_SHA256 =
  process.env.CODEWIDE_E2E_EXPECTED_COMPANION_SHA256?.trim() ?? null;
const EXPECTED_SOURCE_FINGERPRINT =
  process.env.CODEWIDE_E2E_EXPECTED_SOURCE_FINGERPRINT?.trim() ?? null;
const VISUAL_DIFF_MAX_RATIO = readRatioEnvironment("CODEWIDE_E2E_VISUAL_DIFF_MAX_RATIO", 0.025);
const STREAM_UI_LATENCY_BUDGET_MS = readPositiveIntegerEnvironment(
  "CODEWIDE_E2E_STREAM_UI_LATENCY_MS",
  2_000,
);

type StepEvidence = {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

type Evidence = {
  schemaVersion: 1;
  suite: "full" | "v2Only" | "visualParityOnly";
  backend: "managedAppServer";
  buildMode: "fresh" | "prebuilt";
  completedAt: string;
  runId: string;
  sourceFingerprint: string;
  passed: boolean;
  deviceKind: "emulator" | "physical" | null;
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

type AndroidGlobalSetting = { exists: false } | { exists: true; value: string };

const runId = `${timestamp()}-${randomUUID().slice(0, 8)}`;
const artifactDir = path.join(REPO_ROOT, "test-results", "android-e2e", runId);
const parityArtifactDir = path.join(artifactDir, "visual-parity");
const steps: StepEvidence[] = [];
const videos: string[] = [];
const observations: E2EObservation[] = [];
const visualParityCaptures = new Map<string, VisualParityRowCapture>();
const visualParityMacroFailures: string[] = [];
const captureProvenance: AndroidE2eCaptureProvenance[] = [];
let currentFoldPosture: "folded" | "unfolded" = "unfolded";
let parityArchivedCatalogState: "empty" | "populated" | null = null;
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
  const sourceFingerprintBeforeRun = await computeSourceFingerprint(REPO_ROOT);
  requireExpectedFingerprint("source", sourceFingerprintBeforeRun, EXPECTED_SOURCE_FINGERPRINT);
  const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "codewide-android-e2e-"));
  await chmod(runtimeDir, 0o700);
  const processes: ManagedProcess[] = [];
  const reversePorts: number[] = [];
  const pushedDeviceFiles: string[] = [];
  const generatedRepoFiles: string[] = [];
  let device: AndroidDevice | null = null;
  let driver: AppiumBrowser | null = null;
  let appServer: AppServerClient | null = null;
  let fixtureHttpServer: Server | null = null;
  let threadId: string | null = null;
  let parityThreadId: string | null = null;
  let parityEmptyThreadId: string | null = null;
  let parityEmptyThreadTitle: string | null = null;
  let parityAgentFixture: ParityAgentFixture | null = null;
  let threadRowParityFixture: ThreadRowParityFixture | null = null;
  let conversationLifecycleFixture: ConversationLifecycleParityFixture | null = null;
  let resourceParityFixture: ResourceParityFixture | null = null;
  let parityThreadTitle: string | null = null;
  let parityReplies: string[] = [];
  let parityReply: string | null = null;
  let failure: Error | null = null;
  let visualParityFinalized = false;
  let previousSysuiDemoAllowed: AndroidGlobalSetting | null = null;
  let actualAvd: string | null = null;
  let apkSha256 = "";
  let companionSha256 = "";

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

    [apkSha256, companionSha256] = await Promise.all([
      sha256File(APK_PATH),
      sha256File(COMPANION_PATH),
    ]);
    requireExpectedFingerprint("APK", apkSha256, EXPECTED_APK_SHA256);
    requireExpectedFingerprint("Companion", companionSha256, EXPECTED_COMPANION_SHA256);

    device = await step("acquire Android virtual device", () =>
      acquireAndroidDevice(REPO_ROOT, artifactDir),
    );
    actualAvd = await readRunningAvd(device);
    requireTargetAvd(actualAvd);
    previousSysuiDemoAllowed = await readGlobalSetting(device, "sysui_demo_allowed");
    const metroPort = await findFreePort();
    const companionPort = await findFreePort();
    const appiumPort = await findFreePort();
    const fixtureWeb = await step("start localhost browser fixture", () =>
      startFixtureHttpServer(`WEBOK${runId.replaceAll(/[^A-Za-z0-9]/g, "").toUpperCase()}`),
    );
    fixtureHttpServer = fixtureWeb.server;
    const companion = await startCompanion(runtimeDir, companionPort);
    processes.push(companion.process);
    resourceParityFixture = await createResourceParityFixture(
      artifactDir,
      runId,
      fixtureWeb.port,
      fixtureWeb.marker,
      companion.controlEndpoint,
      companion.tokenFile,
    );
    const metro = await startMetro(metroPort);
    processes.push(metro);
    const reversedPorts = await step("reverse Metro and Companion ports", async () => {
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
      if (device!.serial.startsWith("emulator-")) {
        await adb(device!, REPO_ROOT, ["logcat", "-c"], { allowFailure: true });
      }
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
      await captureZeroServerParityAcrossGenerations(driver!, device!);
      await openAddServerFromCurrentSurface(driver!);
      await captureManualPairingParityState(driver!, device!, "v1");
      await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, pairingLink);
      await connectAndCapturePairingParityStates(
        driver!,
        device!,
        "v1",
        { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
        runId,
      );
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
        parityReplies = [
          `PARITYONE${nonce}`,
          `PARITYTWO${nonce}`,
          `PARITYTHREE${nonce}`,
          `PARITYATTACH${nonce}`,
        ];
        const finalParityReply = parityReplies.at(-1);
        if (finalParityReply === undefined) throw new Error("Visual parity replies are empty");
        const parityChangeName = requireResourceParityFixture(resourceParityFixture).change.name;
        const parityChangePath = path.join(REPO_ROOT, parityChangeName);
        requireResourceParityFixture(resourceParityFixture).change.path = parityChangePath;
        generatedRepoFiles.push(parityChangePath);
        parityReply = finalParityReply;
        parityThreadId = await appServer!.createThread(REPO_ROOT, parityThreadTitle);
        parityEmptyThreadTitle = `Visual parity empty ${nonce.slice(-12)}`;
        parityEmptyThreadId = await appServer!.createThread(REPO_ROOT, parityEmptyThreadTitle);
        const agentParentTitle = `Visual parity agent ${nonce.slice(-12)}`;
        const agentParentReply = `PARENTSUBAGENT${nonce}`;
        const agentChildReply = `CHILDOK${nonce}`;
        const agentParentThreadId = await appServer!.createSubagentFixtureThread(
          REPO_ROOT,
          agentParentTitle,
        );
        await appServer!.subscribeThread(agentParentThreadId);
        await appServer!.startSubscribedTurn(
          agentParentThreadId,
          `Call spawn_agent exactly once. Use task_name parity_child_${nonce.toLowerCase()} and ask that child to reply exactly ${agentChildReply} without using tools. Wait until the child finishes. Then reply exactly ${agentParentReply}.`,
          `e2e-parity-agent-${nonce.toLowerCase()}`,
          "high",
        );
        await appServer!.waitForAgentText(
          agentParentThreadId,
          agentParentReply,
          APP_SERVER_TIMEOUT_MS,
        );
        const agentChildThreadId = await appServer!.waitForSingleChildThread(
          agentParentThreadId,
          APP_SERVER_TIMEOUT_MS,
        );
        await appServer!.waitForAgentText(
          agentChildThreadId,
          agentChildReply,
          APP_SERVER_TIMEOUT_MS,
        );
        parityAgentFixture = {
          childReply: agentChildReply,
          childThreadId: agentChildThreadId,
          parentReply: agentParentReply,
          parentThreadId: agentParentThreadId,
          parentTitle: agentParentTitle,
        };
        for (const [index, reply] of parityReplies.entries()) {
          const message =
            index === parityReplies.length - 1
              ? `PARITYTURN${index + 1}${nonce}. First run /bin/pwd, then use apply_patch to create ${parityChangeName} containing PARITY_CHANGE_CONTENT, then reply with exactly this Markdown and no surrounding commentary:\n# Parity heading ${reply}\n- Parity list item\n> Parity quote\n\n| Parity column | Value |\n| --- | --- |\n| Parity cell | 42 |\n\n\`\`\`text\nPARITY_CODE_BLOCK\n\`\`\`\n\n[Parity link](https://example.com/parity).`
              : `PARITYTURN${index + 1}${nonce}. Reply exactly ${reply}.`;
          const clientId = `e2e-parity-${index + 1}-${nonce.toLowerCase()}`;
          if (index === parityReplies.length - 1) {
            await appServer!.startSubscribedTurnWithMention(
              parityThreadId,
              message,
              clientId,
              { name: "package.json", path: path.join(REPO_ROOT, "package.json") },
              "high",
            );
          } else {
            await appServer!.startSubscribedTurn(parityThreadId, message, clientId, "high");
          }
          await appServer!.waitForAgentText(parityThreadId, reply, APP_SERVER_TIMEOUT_MS);
        }
        if (resourceParityFixture === null) {
          throw new Error("Resource parity fixture was not created");
        }
        const parityImageReply = `PARITYIMAGE${nonce}`;
        const parityImageInput = `PARITYIMAGEINPUT${nonce}`;
        await appServer!.startSubscribedTurnWithMention(
          parityThreadId,
          `${parityImageInput}. Reply exactly ${parityImageReply}.`,
          `e2e-parity-image-${nonce.toLowerCase()}`,
          { name: resourceParityFixture.image.name, path: resourceParityFixture.image.path },
          "low",
        );
        await appServer!.waitForAgentText(parityThreadId, parityImageReply, APP_SERVER_TIMEOUT_MS);
        parityReplies.push(parityImageReply);
        const parityVideoReply = `PARITYVIDEO${nonce}`;
        await appServer!.startSubscribedTurnWithMention(
          parityThreadId,
          `PARITYVIDEOINPUT${nonce}. Reply exactly ${parityVideoReply}.`,
          `e2e-parity-video-${nonce.toLowerCase()}`,
          { name: resourceParityFixture.video.name, path: resourceParityFixture.video.path },
          "low",
        );
        await appServer!.waitForAgentText(parityThreadId, parityVideoReply, APP_SERVER_TIMEOUT_MS);
        parityReplies.push(parityVideoReply);
        threadRowParityFixture = await createThreadRowParityFixture(
          appServer!,
          REPO_ROOT,
          nonce,
          APP_SERVER_TIMEOUT_MS,
        );
        conversationLifecycleFixture = await createConversationLifecycleParityFixture(
          appServer!,
          REPO_ROOT,
          nonce,
          APP_SERVER_TIMEOUT_MS,
          {
            id: parityThreadId,
            name: resourceParityFixture.image.name,
            title: parityThreadTitle,
            userMarker: parityImageInput,
          },
        );
        await access(parityChangePath);
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
          await capturePhoneConversationParityStates(
            driver!,
            device!,
            "v1",
            Math.min(3, parityReplies.length),
          );
          await captureVoiceFaultParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v1", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v1",
            layout: "phone",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreConversation: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                true,
                finalParityReply,
              );
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await driver!.back();
          await waitForAccessibility(driver!, "New thread");
          await clickAccessibility(driver!, "Choose server");
          await selectFirstConnectedServer(driver!);
          await waitForAccessibility(driver!, "New thread");
          await waitForAnyThreadRow(driver!);
          await captureThreadSearchVoiceParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v1", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v1",
            layout: "phone",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreThreadList: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await returnToThreadListSurface(driver!);
              await waitForAccessibility(driver!, "Search threads");
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await capturePhoneThreadListParityStates(driver!, device!, "v1");
          await captureAdditionalPhoneParityStates({
            agentFixture: requireParityAgentFixture(parityAgentFixture),
            appServer: appServer!,
            companionDevicePort: reversedPorts.companionDevicePort,
            companionHostPort: companionPort,
            conversationLifecycleFixture:
              requireConversationLifecycleFixture(conversationLifecycleFixture),
            device: device!,
            driver: driver!,
            emptyThreadId: parityEmptyThreadId,
            emptyThreadTitle: parityEmptyThreadTitle,
            expectedCompletedTurns: Math.min(3, parityReplies.length),
            generation: "v1",
            nonce,
            reopenConversation: async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                true,
                finalParityReply,
              );
            },
            resourceFixture: requireResourceParityFixture(resourceParityFixture),
            threadRowFaultControl: {
              endpoint: companion.controlEndpoint,
              tokenFile: companion.tokenFile,
            },
            threadRowFixture: requireThreadRowParityFixture(threadRowParityFixture),
          });
        } else {
          await setThreadSearchQuery(driver!, paritySearchQuery(finalParityReply));
          await captureThreadListParityRows(
            driver!,
            "v1",
            "wide",
            paritySearchQuery(finalParityReply),
          );
          await captureThreadSearchVoiceParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v1", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v1",
            layout: "wide",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreThreadList: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
              await waitForAccessibility(driver!, "Search threads");
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureThreadRowParityScenario(
            driver!,
            device!,
            appServer!,
            "v1",
            "wide",
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
          );
          await captureConversationLifecycleParityStates(
            driver!,
            device!,
            appServer!,
            "v1",
            "wide",
            requireConversationLifecycleFixture(conversationLifecycleFixture),
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
          );
          await reopenLegacyThreadContaining(driver!, parityThreadTitle, false, finalParityReply);
          await prepareVisualParityState(driver!, device!, "wide");
          await waitForVisualParityProjectionReady(driver!, parityReplies.length);
          await captureVisualParityState(driver!, "wide-selected-thread-v1");
          await captureConversationShellParityRows(
            driver!,
            "v1",
            "wide",
            Math.min(3, parityReplies.length),
          );
          await captureVoiceFaultParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v1", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v1",
            layout: "wide",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreConversation: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureBootParityStates({
            activityName: ACTIVITY_NAME,
            captureRow: captureVisualParityRow,
            device: device!,
            driver: driver!,
            generation: "v1",
            layout: "wide",
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreReady: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureLifecycleParityStates(
            driver!,
            device!,
            "v1",
            "wide",
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
            parityReplies.length,
            reversedPorts.companionDevicePort,
            companionPort,
          );
          await captureWideOverlayParityStates(driver!, "v1");
          await captureConversationControlParityStates(driver!, "v1", "wide");
          await captureRequestDraftParityStates(
            driver!,
            device!,
            appServer!,
            requireResourceParityFixture(resourceParityFixture).control,
            "v1",
            "wide",
            nonce,
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
          );
          await captureQueueParityStates(driver!, appServer!, "v1", "wide", nonce, async () => {
            await reopenLegacyThreadContaining(
              driver!,
              parityThreadTitle!,
              false,
              finalParityReply,
            );
          });
          await captureFoldableParityStates(
            driver!,
            device!,
            "v1",
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
              for (const reply of parityReplies) await waitForVisibleTextContaining(driver!, reply);
            },
            parityReplies.length,
            parityEmptyThreadId,
            parityEmptyThreadTitle,
            requireParityAgentFixture(parityAgentFixture),
            reversedPorts.companionDevicePort,
            companionPort,
            appServer!,
            nonce,
            requireResourceParityFixture(resourceParityFixture),
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
            requireConversationLifecycleFixture(conversationLifecycleFixture),
          );
          await captureNewThreadParityStates(
            driver!,
            "v1",
            "wide",
            nonce,
            requireResourceParityFixture(resourceParityFixture).control,
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
          );
          await captureSettingsParityStates(
            driver!,
            device!,
            "v1",
            "wide",
            reversedPorts.companionDevicePort,
            companionPort,
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
          );
          await captureStaticResourceParityStates(
            driver!,
            device!,
            "v1",
            requireResourceParityFixture(resourceParityFixture),
          );
          await captureAgentParityStates(
            driver!,
            device!,
            "v1",
            "wide",
            requireParityAgentFixture(parityAgentFixture),
            companionPort,
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
          );
          await captureEmptyThreadParityState(
            driver!,
            "v1",
            parityEmptyThreadId,
            parityEmptyThreadTitle,
            async () => {
              await reopenLegacyThreadContaining(
                driver!,
                parityThreadTitle!,
                false,
                finalParityReply,
              );
            },
          );
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

    requireResourceParityFixture(resourceParityFixture).ownerDeviceId =
      await grantShellScopeToOnlyDevice(companion.controlEndpoint, companion.tokenFile);
    const secondPairingLink = await createPairing(
      companion.controlEndpoint,
      companion.tokenFile,
      reversedPorts.companionDevicePort,
    );
    await caseWithVideo(driver, "06-v2-generation-and-saved-server", async () => {
      // V1 intentionally owns settings as an in-place sheet; `codewide://settings`
      // is an Expo Router destination and is not consumed by the V1 shell.
      await clickAccessibility(driver!, "Settings");
      await clickAccessibility(driver!, "Use V2 interface");
      await delay(1_500);
      await driver!.terminateApp(PACKAGE_NAME);
      await stopAndroidConnectionService(device!);
      await activateApplication(driver!, PACKAGE_NAME);
      await waitForApplicationReady(driver!);
      await waitForVisibleTextContaining(driver!, "All threads");
      await clickAccessibility(driver!, "Choose server");
      await assertDarkSystemBars(driver!, "server-selector");
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
          "phone-thread-menu",
          "phone-conversation-search",
          "phone-composer-one-line",
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
          await capturePhoneConversationParityStates(
            driver!,
            device!,
            "v2",
            Math.min(3, parityReplies.length),
          );
          await captureVoiceFaultParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v2", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v2",
            layout: "phone",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreConversation: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await driver!.back();
          await waitForAccessibility(driver!, "New thread");
          await clickAccessibility(driver!, "Choose server");
          await selectFirstConnectedServer(driver!);
          await waitForAccessibility(driver!, "New thread");
          await waitForAnyThreadRow(driver!);
          await captureThreadSearchVoiceParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v2", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v2",
            layout: "phone",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreThreadList: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await returnToThreadListSurface(driver!);
              await waitForAccessibility(driver!, "Search threads");
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await capturePhoneThreadListParityStates(driver!, device!, "v2");
          await captureAdditionalPhoneParityStates({
            agentFixture: requireParityAgentFixture(parityAgentFixture),
            appServer: appServer!,
            companionDevicePort: reversedPorts.companionDevicePort,
            companionHostPort: companionPort,
            conversationLifecycleFixture:
              requireConversationLifecycleFixture(conversationLifecycleFixture),
            device: device!,
            driver: driver!,
            emptyThreadId: parityEmptyThreadId,
            emptyThreadTitle: parityEmptyThreadTitle,
            expectedCompletedTurns: Math.min(3, parityReplies.length),
            generation: "v2",
            nonce,
            reopenConversation: async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
            resourceFixture: requireResourceParityFixture(resourceParityFixture),
            threadRowFaultControl: {
              endpoint: companion.controlEndpoint,
              tokenFile: companion.tokenFile,
            },
            threadRowFixture: requireThreadRowParityFixture(threadRowParityFixture),
          });
        } else {
          await setThreadSearchQuery(driver!, paritySearchQuery(parityReply));
          await captureThreadListParityRows(driver!, "v2", "wide", paritySearchQuery(parityReply));
          await captureThreadSearchVoiceParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v2", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v2",
            layout: "wide",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreThreadList: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
              await waitForAccessibility(driver!, "Search threads");
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureThreadRowParityScenario(
            driver!,
            device!,
            appServer!,
            "v2",
            "wide",
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
          );
          await captureConversationLifecycleParityStates(
            driver!,
            device!,
            appServer!,
            "v2",
            "wide",
            requireConversationLifecycleFixture(conversationLifecycleFixture),
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
          );
          await openProjectedThreadContaining(driver!, parityReply, parityThreadId);
          await prepareVisualParityState(driver!, device!, "wide");
          await waitForVisualParityProjectionReady(driver!, parityReplies.length);
          await captureVisualParityState(driver!, "wide-selected-thread-v2");
          await captureConversationShellParityRows(
            driver!,
            "v2",
            "wide",
            Math.min(3, parityReplies.length),
          );
          await captureVoiceFaultParity({
            capture: (rowId, state, assertExactState) =>
              captureVisualParityRow(driver!, "v2", rowId, state, assertExactState),
            control: requireResourceParityFixture(resourceParityFixture).control,
            device: device!,
            driver: driver!,
            generation: "v2",
            layout: "wide",
            nonce,
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreConversation: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureBootParityStates({
            activityName: ACTIVITY_NAME,
            captureRow: captureVisualParityRow,
            device: device!,
            driver: driver!,
            generation: "v2",
            layout: "wide",
            packageName: PACKAGE_NAME,
            repoRoot: REPO_ROOT,
            restoreReady: async () => {
              await activateApplication(driver!, PACKAGE_NAME);
              await waitForApplicationReady(driver!);
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
              await waitForVisualParityProjectionReady(driver!, parityReplies.length);
            },
            timeoutMs: UI_TIMEOUT_MS,
          });
          await captureLifecycleParityStates(
            driver!,
            device!,
            "v2",
            "wide",
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
            parityReplies.length,
            reversedPorts.companionDevicePort,
            companionPort,
          );
          await captureWideOverlayParityStates(driver!, "v2");
          await captureConversationControlParityStates(driver!, "v2", "wide");
          await captureRequestDraftParityStates(
            driver!,
            device!,
            appServer!,
            requireResourceParityFixture(resourceParityFixture).control,
            "v2",
            "wide",
            nonce,
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
          );
          await captureQueueParityStates(driver!, appServer!, "v2", "wide", nonce, async () => {
            await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
          });
          await captureFoldableParityStates(
            driver!,
            device!,
            "v2",
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
              for (const reply of parityReplies) await waitForVisibleTextContaining(driver!, reply);
            },
            parityReplies.length,
            parityEmptyThreadId,
            parityEmptyThreadTitle,
            requireParityAgentFixture(parityAgentFixture),
            reversedPorts.companionDevicePort,
            companionPort,
            appServer!,
            nonce,
            requireResourceParityFixture(resourceParityFixture),
            requireThreadRowParityFixture(threadRowParityFixture),
            { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
            requireConversationLifecycleFixture(conversationLifecycleFixture),
          );
          await captureNewThreadParityStates(
            driver!,
            "v2",
            "wide",
            nonce,
            requireResourceParityFixture(resourceParityFixture).control,
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
          );
          await captureSettingsParityStates(
            driver!,
            device!,
            "v2",
            "wide",
            reversedPorts.companionDevicePort,
            companionPort,
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
          );
          await captureStaticResourceParityStates(
            driver!,
            device!,
            "v2",
            requireResourceParityFixture(resourceParityFixture),
          );
          await captureAgentParityStates(
            driver!,
            device!,
            "v2",
            "wide",
            requireParityAgentFixture(parityAgentFixture),
            companionPort,
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
          );
          await captureEmptyThreadParityState(
            driver!,
            "v2",
            parityEmptyThreadId,
            parityEmptyThreadTitle,
            async () => {
              await openProjectedThreadContaining(driver!, parityReply!, parityThreadId!);
            },
          );
        }
        const parityStates = PHONE_VISUAL_PARITY
          ? [
              "phone-selected-thread",
              "phone-context-usage",
              "phone-composer-menu",
              "phone-thread-menu",
              "phone-conversation-search",
              "phone-composer-one-line",
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
              "wide-thread-menu",
              "wide-conversation-search",
              "wide-composer-one-line",
              "phone-selected-thread",
              "phone-context-usage",
              "phone-composer-menu",
              "phone-thread-menu",
              "phone-conversation-search",
              "phone-composer-one-line",
              "phone-thread-list",
              "phone-server-selector",
              "phone-thread-filters",
              "phone-thread-list-menu",
            ];
        for (const state of parityStates) {
          await writeVisualParityDiff(state);
        }
      }
      if (VISUAL_PARITY_ONLY) {
        await openAddServerFromCurrentSurface(driver!);
        await captureManualPairingParityState(driver!, device!, "v2");
        await driver!.execute("mobile: setClipboard", {
          content: Buffer.from(secondPairingLink).toString("base64"),
          contentType: "plaintext",
        });
        await clickPasteConnectionLink(driver!);
        await connectAndCapturePairingParityStates(
          driver!,
          device!,
          "v2",
          { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
          runId,
        );
        await waitForAccessibility(driver!, "New thread");
        return;
      }

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
      await assertDarkSystemBars(driver!, "project-picker");
      const availableProject = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Project ")',
      );
      await availableProject.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await availableProject.click();
      await clickAccessibility(driver!, "Workspace mode, in this folder");
      await assertDarkSystemBars(driver!, "workspace-mode-new");
      await clickVisibleText(driver!, "New workspace");
      await waitForAccessibility(driver!, "Workspace mode, new workspace");
      observe("v2WorkspaceMode", "appium", "isolatedSelected");
      await clickAccessibility(driver!, "Workspace mode, new workspace");
      await assertDarkSystemBars(driver!, "workspace-mode-folder");
      await clickVisibleText(driver!, "In this folder");
      await waitForAccessibility(driver!, "Workspace mode, in this folder");
      const newThreadModelChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
      );
      await newThreadModelChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await newThreadModelChip.click();
      await assertDarkSystemBars(driver!, "new-thread-model-thinking");
      await waitForVisibleTextContaining(driver!, "Thinking level");
      await clickVisibleText(driver!, "Extra high");
      const selectedThinkingChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ").descriptionContains(", xhigh")',
      );
      await selectedThinkingChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      observe("v2ThinkingLevel", "appium", "xhighSelected");
      const firstMessage = await waitForAccessibility(driver!, "Message Codex");
      await firstMessage.setValue(v2Message);
      const fault = await armCommandFault(companion.controlEndpoint, companion.tokenFile);
      observe("faultArmed", "companionPrivateControl", fault.state);
      const companionLog = path.join(artifactDir, "companion.log");
      const admissionCheckpoint = (await stat(companionLog)).size;
      if (device!.serial.startsWith("emulator-")) {
        await adb(device!, REPO_ROOT, ["logcat", "-c"]);
      }
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
      await clickAccessibility(driver!, "Thread menu");
      await assertDarkSystemBars(driver!, "thread-menu-pin");
      await clickVisibleText(driver!, "Pin thread");
      await clickAccessibility(driver!, "Thread menu");
      await assertDarkSystemBars(driver!, "thread-menu-unpin");
      await waitForVisibleTextContaining(driver!, "Unpin thread");
      await clickVisibleText(driver!, "Unpin thread");
      await clickAccessibility(driver!, "Thread menu");
      await assertDarkSystemBars(driver!, "thread-menu-restored");
      await waitForVisibleTextContaining(driver!, "Pin thread");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      observe("v2ThreadPin", "appium", "pinAndUnpinRendered");
      const initialPermissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: Full access")',
      );
      await initialPermissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await assertContextChipAbsent(driver!, ["No changes", "Changes ·", "Loading changes"]);
      await assertContextChipAbsent(driver!, [
        "No attachments",
        "Attachments ·",
        "Loading attachments",
      ]);
      const modelChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
      );
      await modelChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await modelChip.click();
      await assertDarkSystemBars(driver!, "conversation-model-thinking");
      await waitForVisibleTextContaining(driver!, "GPT-5.6-Sol");
      await driver!.back();
      const permissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: ")',
      );
      await permissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await permissionsChip.click();
      await assertDarkSystemBars(driver!, "permissions-workspace");
      await clickVisibleText(driver!, "Workspace");
      const workspacePermissionsChip = await driver!.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: Workspace")',
      );
      await workspacePermissionsChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      await workspacePermissionsChip.click();
      await assertDarkSystemBars(driver!, "permissions-full-access");
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
          throw new Error(
            "V2 voice input did not start; an unavailable microphone is not a passing round trip",
          );
        }
      }
      if (await stopVoice.isDisplayed().catch(() => false)) {
        await clickAccessibility(driver!, "Back to threads");
        await waitForAccessibility(driver!, "New thread");
        await openProjectedThreadContaining(driver!, v2Reply, threadId);
        await waitForAccessibility(driver!, "Stop voice input and insert transcript");
        await driver!.pressKeyCode(3);
        await activateApplication(driver!, PACKAGE_NAME);
        await waitForAccessibility(driver!, "Stop voice input and insert transcript");
        await clickAccessibility(driver!, "Stop voice input and insert transcript");
        await waitForRightmostAccessibility(driver!, "Voice input");
        observe(
          "v2VoiceRoundTrip",
          "appium",
          "captureSurvivedThreadNavigationAndBackgroundThenClosed",
        );
      }

      await clickAccessibility(driver!, "Composer menu");
      await assertDarkSystemBars(driver!, "composer-menu");
      await clickVisibleText(driver!, "Skills");
      await assertDarkSystemBars(driver!, "skills");
      await waitForAccessibility(driver!, "Close skills");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      await clickAccessibility(driver!, "Thread menu");
      await assertDarkSystemBars(driver!, "thread-menu-session-id");
      await waitForVisibleTextContaining(driver!, "Copy session ID");
      await driver!.back();
      await waitForAccessibility(driver!, "Message Codex");
      const settings = await driver!.$("~Settings");
      if (!(await settings.isDisplayed().catch(() => false))) {
        await clickAccessibility(driver!, "Back to threads");
        await clickAccessibility(driver!, "Choose server");
      }
      await waitForAccessibility(driver!, "Settings");
      await clickAccessibility(driver!, "Settings");
      await assertDarkSystemBars(driver!, "settings");
      await waitForAccessibility(driver!, "Close server settings");
      await scrollAccessibilityIntoView(driver!, "Actions for CodeWide E2E");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await assertDarkSystemBars(driver!, "settings-server-actions");
      await clickVisibleText(driver!, "Edit server");
      await waitForVisibleTextContaining(driver!, "Server settings");
      await assertDarkSystemBars(driver!, "saved-server-settings");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await assertDarkSystemBars(driver!, "saved-server-actions");
      await clickVisibleText(driver!, "Reconnect");
      await driver!.back();
      await waitForAccessibility(driver!, "Close server settings");
      await clickAccessibility(driver!, "Close server settings");
      await waitForAccessibility(driver!, "Message Codex");
      await driver!.back();
      await waitForAccessibility(driver!, "Add server");

      await clickAccessibility(driver!, "Add server");
      await captureManualPairingParityState(driver!, device!, "v2");
      await driver!.execute("mobile: setClipboard", {
        content: Buffer.from(secondPairingLink).toString("base64"),
        contentType: "plaintext",
      });
      await clickPasteConnectionLink(driver!);
      await connectAndCapturePairingParityStates(
        driver!,
        device!,
        "v2",
        { endpoint: companion.controlEndpoint, tokenFile: companion.tokenFile },
        runId,
      );
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
      await assertDarkSystemBars(driver!, "second-server-actions");
      await clickVisibleText(driver!, "Edit server");
      await waitForVisibleTextContaining(driver!, "Server settings");
      await clickAccessibility(driver!, "Actions for CodeWide E2E");
      await assertDarkSystemBars(driver!, "delete-server-actions");
      await clickVisibleText(driver!, "Delete server");
      await waitForAccessibility(driver!, "Confirm delete server");
      await clickAccessibility(driver!, "Confirm delete server");
      await waitForVisibleTextContaining(driver!, "All threads");
      await clickAccessibility(driver!, "Choose server");
      await assertDarkSystemBars(driver!, "server-selector-after-delete");
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

    if (!VISUAL_PARITY_ONLY && threadId !== null) {
      await caseWithVideo(driver, "07-v2-live-background-queue-and-recovery", async () => {
        await openOriginalServerAndThread(driver!, threadId!, v2ThreadMarker(nonce));

        const foregroundPartial = `V2PARTIAL${nonce}`;
        const foregroundReply = `V2FOREGROUNDOK${nonce}`;
        const foregroundMessage = `V2FOREGROUND${nonce}. Start with ${foregroundPartial}, then write 120 numbered one-word lines so streaming remains observable, then end with ${foregroundReply}.`;
        await appServer!.subscribeThread(threadId!);
        const runningObserved = waitForVisibleTextContaining(driver!, "Running");
        await sendComposerMessage(driver!, foregroundMessage, {
          beforeSend: () => resizeAndroidViewport(device!, driver!, "Message Codex"),
          requireKeyboard: true,
        });
        await appServer!.waitForThreadNotification(
          "turn/started",
          threadId!,
          APP_SERVER_TIMEOUT_MS,
        );
        const delta = await appServer!.waitForAgentDeltaText(
          threadId!,
          foregroundPartial,
          APP_SERVER_TIMEOUT_MS,
        );
        await runningObserved;
        const deltaToUiLatencyMs = await waitForVisibleTextWithinBudget(
          driver!,
          foregroundPartial,
          delta.matchedAtMs,
          STREAM_UI_LATENCY_BUDGET_MS,
        );
        observe(
          "v2AppServerDeltaToPartialUi",
          "appServerNotificationAndAppium",
          `renderedIn${deltaToUiLatencyMs}msWithin${STREAM_UI_LATENCY_BUDGET_MS}ms`,
          delta.turnId,
        );
        await waitForTextHidden(driver!, foregroundReply);
        await appServer!.waitForUserText(threadId!, foregroundMessage, APP_SERVER_TIMEOUT_MS);
        await appServer!.waitForAgentText(threadId!, foregroundReply, APP_SERVER_TIMEOUT_MS);
        await waitForVisibleTextContaining(driver!, foregroundReply);
        observe("v2ForegroundStream", "appiumAndAppServer", "deltaAndFinalRendered");

        const liveBackgroundReply = `V2LIVEBACKGROUNDOK${nonce}`;
        const liveBackgroundMessage = `V2LIVEBACKGROUND${nonce}. Reply exactly ${liveBackgroundReply}.`;
        appServer!.clearThreadNotifications(threadId!);
        await clearTurnNotifications(driver!);
        await driver!.pressKeyCode(3);
        const liveBackgroundClient = await AppServerClient.connect(appServerSocket());
        let liveBackgroundTurnId: string;
        try {
          liveBackgroundTurnId = await liveBackgroundClient.startTurn(
            threadId!,
            liveBackgroundMessage,
            `e2e-v2-live-background-${nonce.toLowerCase()}`,
          );
          await appServer!.waitForAgentText(threadId!, liveBackgroundReply, APP_SERVER_TIMEOUT_MS);
        } finally {
          liveBackgroundClient.close();
        }
        await appServer!.waitForThreadNotificationSequence(
          threadId!,
          [
            { method: "turn/started", turnId: liveBackgroundTurnId },
            { method: "turn/completed", turnId: liveBackgroundTurnId },
          ],
          APP_SERVER_TIMEOUT_MS,
        );
        await appServer!.waitForExactThreadNotificationCount(
          "turn/completed",
          threadId!,
          1,
          APP_SERVER_TIMEOUT_MS,
          liveBackgroundTurnId,
        );
        await openSingleTurnNotification(driver!, "Codex turn completed", "live-background");
        await waitForApplicationReady(driver!);
        await waitForVisibleTextContaining(driver!, liveBackgroundReply);
        observe(
          "v2LiveBackgroundNotification",
          "appiumNotificationAndIndependentAppServerClient",
          `singleNotificationDeepLinkedToThread:${threadId}:token:${liveBackgroundReply}`,
          liveBackgroundTurnId,
        );

        const backgroundReply = `V2BACKGROUNDOK${nonce}`;
        const backgroundMessage = `V2BACKGROUND${nonce}. Reply exactly ${backgroundReply}.`;
        appServer!.clearThreadNotifications(threadId!);
        await clearTurnNotifications(driver!);
        await driver!.pressKeyCode(3);
        await restartAndroidConnectionService(device!);
        const externalClient = await AppServerClient.connect(appServerSocket());
        let backgroundTurnId: string;
        try {
          backgroundTurnId = await externalClient.startTurn(
            threadId!,
            backgroundMessage,
            `e2e-v2-background-${nonce.toLowerCase()}`,
          );
          await appServer!.waitForAgentText(threadId!, backgroundReply, APP_SERVER_TIMEOUT_MS);
        } finally {
          externalClient.close();
        }
        await appServer!.waitForThreadNotificationSequence(
          threadId!,
          [
            { method: "turn/started", turnId: backgroundTurnId },
            { method: "turn/completed", turnId: backgroundTurnId },
          ],
          APP_SERVER_TIMEOUT_MS,
        );
        await appServer!.waitForExactThreadNotificationCount(
          "turn/completed",
          threadId!,
          1,
          APP_SERVER_TIMEOUT_MS,
          backgroundTurnId,
        );
        await openSingleTurnNotification(driver!, "Codex turn completed", "process-recreated");
        await waitForApplicationReady(driver!);
        await waitForVisibleTextContaining(driver!, backgroundReply);
        observe(
          "v2BackgroundDirectUpdate",
          "appiumNotificationAndIndependentAppServerClient",
          `serviceRecreatedHeadlesslyThenSingleNotificationDeepLinkedToThread:${threadId}:token:${backgroundReply}`,
          backgroundTurnId,
        );

        const slowReply = `V2SLOWOK${nonce}`;
        const firstQueuedReply = `V2QUEUEONEOK${nonce}`;
        const secondQueuedReply = `V2QUEUETWOOK${nonce}`;
        const slowMessage = `Run /bin/sh -c 'sleep 45' and then reply exactly ${slowReply}.`;
        const firstQueuedMessage = `V2QUEUEONE${nonce}. Reply exactly ${firstQueuedReply}.`;
        const secondQueuedMessage = `V2QUEUETWO${nonce}. Reply exactly ${secondQueuedReply}.`;
        appServer!.clearThreadNotifications(threadId!);
        const slowTurnId = await appServer!.startTurn(
          threadId!,
          slowMessage,
          `e2e-v2-slow-${nonce.toLowerCase()}`,
        );
        await waitForAccessibility(driver!, "Delivery mode: Queue");
        await sendComposerMessage(driver!, firstQueuedMessage, { requireKeyboard: true });
        await sendComposerMessage(driver!, secondQueuedMessage, { requireKeyboard: true });
        await assertQueuedPrompts(
          driver!,
          [firstQueuedMessage, secondQueuedMessage],
          "queue-before-reconnect",
        );

        await driver!.terminateApp(PACKAGE_NAME);
        await stopAndroidConnectionService(device!);
        await removeReversePort(device!, REPO_ROOT, reversedPorts.companionDevicePort);
        await delay(1_500);
        await adb(device!, REPO_ROOT, [
          "reverse",
          `tcp:${reversedPorts.companionDevicePort}`,
          `tcp:${companionPort}`,
        ]);
        await activateApplication(driver!, PACKAGE_NAME);
        await waitForApplicationReady(driver!);
        await openOriginalServerAndThread(driver!, threadId!, v2ThreadMarker(nonce));
        await assertQueuedPrompts(
          driver!,
          [firstQueuedMessage, secondQueuedMessage],
          "queue-after-reconnect",
        );

        await appServer!.waitForAgentText(threadId!, slowReply, APP_SERVER_TIMEOUT_MS);
        await appServer!.waitForAgentText(threadId!, firstQueuedReply, APP_SERVER_TIMEOUT_MS);
        await appServer!.waitForAgentText(threadId!, secondQueuedReply, APP_SERVER_TIMEOUT_MS);
        const queuedMessages = await appServer!.waitForExactUserMessageSequence(
          threadId!,
          [slowMessage, firstQueuedMessage, secondQueuedMessage],
          APP_SERVER_TIMEOUT_MS,
        );
        const firstQueuedTurn = queuedMessages[1];
        const secondQueuedTurn = queuedMessages[2];
        if (firstQueuedTurn === undefined || secondQueuedTurn === undefined) {
          throw new Error("Authoritative queue proof did not return both queued turns");
        }
        await appServer!.waitForThreadNotificationSequence(
          threadId!,
          [
            { method: "turn/completed", turnId: slowTurnId },
            { method: "turn/started", turnId: firstQueuedTurn.turnId },
            { method: "turn/completed", turnId: firstQueuedTurn.turnId },
            { method: "turn/started", turnId: secondQueuedTurn.turnId },
            { method: "turn/completed", turnId: secondQueuedTurn.turnId },
          ],
          APP_SERVER_TIMEOUT_MS,
        );
        for (const queuedTurn of [firstQueuedTurn, secondQueuedTurn]) {
          await appServer!.waitForExactThreadNotificationCount(
            "turn/started",
            threadId!,
            1,
            APP_SERVER_TIMEOUT_MS,
            queuedTurn.turnId,
          );
          await appServer!.waitForExactThreadNotificationCount(
            "turn/completed",
            threadId!,
            1,
            APP_SERVER_TIMEOUT_MS,
            queuedTurn.turnId,
          );
        }
        await waitForVisibleTextContaining(driver!, firstQueuedReply);
        await waitForVisibleTextContaining(driver!, secondQueuedReply);
        observe(
          "v2Queue",
          "appiumAndAuthoritativeAppServer",
          "twoQueuedTurnsPersistedOnceAndDeliveredFifoAcrossReconnect",
          firstQueuedTurn.turnId,
        );

        const gapReply = `V2GAPOK${nonce}`;
        const gapMessage = `V2GAP${nonce}. Reply exactly ${gapReply}.`;
        await driver!.terminateApp(PACKAGE_NAME);
        await stopAndroidConnectionService(device!);
        await removeReversePort(device!, REPO_ROOT, reversedPorts.companionDevicePort);
        await appServer!.startTurn(threadId!, gapMessage, `e2e-v2-gap-${nonce.toLowerCase()}`);
        await appServer!.waitForAgentText(threadId!, gapReply, APP_SERVER_TIMEOUT_MS);
        await adb(device!, REPO_ROOT, [
          "reverse",
          `tcp:${reversedPorts.companionDevicePort}`,
          `tcp:${companionPort}`,
        ]);
        await activateApplication(driver!, PACKAGE_NAME);
        await waitForApplicationReady(driver!);
        await openOriginalServerAndThread(driver!, threadId!, gapReply);
        await waitForVisibleTextContaining(driver!, gapReply);
        observe(
          "v2ReconnectGap",
          "terminatedTransportAndAppServer",
          "authoritativeRefreshRecoveredMissedEvent",
        );

        await driver!.terminateApp(PACKAGE_NAME);
        await stopAndroidConnectionService(device!);
        await activateApplication(driver!, PACKAGE_NAME);
        await waitForApplicationReady(driver!);
        await openOriginalServerAndThread(driver!, threadId!, secondQueuedReply);
        await waitForVisibleTextContaining(driver!, backgroundReply);
        await waitForVisibleTextContaining(driver!, firstQueuedReply);
        await waitForVisibleTextContaining(driver!, secondQueuedReply);
        await waitForVisibleTextContaining(driver!, gapReply);
        observe("v2ForceStopFreshness", "appiumAndAppServer", "latestAuthorityRestored");
      });

      await caseWithVideo(driver, "08-v2-attachments-and-changes", async () => {
        const attachmentName = `codewide-e2e-${nonce.slice(-12)}.txt`;
        const attachmentToken = `ATTACHMENTBODY${nonce}`;
        const attachmentPath = path.join(artifactDir, attachmentName);
        await writeFile(attachmentPath, `${attachmentToken}\n`, { mode: 0o600 });
        await adb(device!, REPO_ROOT, [
          "push",
          attachmentPath,
          `/sdcard/Download/${attachmentName}`,
        ]);
        pushedDeviceFiles.push(`/sdcard/Download/${attachmentName}`);
        await clickAccessibility(driver!, "Composer menu");
        await clickVisibleText(driver!, "Attach file");
        await chooseAndroidDocument(driver!, attachmentName);
        await waitForAccessibility(driver!, "Draft attachments");
        const attachmentMessage =
          "Read the attached text file and reply with its complete contents only.";
        await sendComposerMessage(driver!, attachmentMessage, { requireKeyboard: true });
        const authoritativeAttachment = await appServer!.waitForUserInputWithAttachment(
          threadId!,
          attachmentMessage,
          { kind: "mention", name: attachmentName, pathBasename: attachmentName },
          APP_SERVER_TIMEOUT_MS,
        );
        await appServer!.waitForAgentText(threadId!, attachmentToken, APP_SERVER_TIMEOUT_MS);
        await waitForVisibleTextContaining(driver!, attachmentToken);
        await openContextChip(driver!, "Attachments ·");
        await assertDarkSystemBars(driver!, "attachments");
        await waitForVisibleTextContaining(driver!, attachmentName);
        await captureRuntimeSurface(driver!, "attachments-populated");
        await clickAccessibility(driver!, `Open attachment ${attachmentName}`);
        await waitForVisibleTextContaining(driver!, attachmentToken);
        await assertDarkSystemBars(driver!, "attachment-preview");
        await captureRuntimeSurface(driver!, "attachment-preview-real-bytes");
        await clickAccessibility(driver!, "Close attachment");
        await clickAccessibility(driver!, "Close attachments");
        await waitForAccessibility(driver!, "Message Codex");
        observe(
          "v2AttachmentAuthoritativeInput",
          "appServerThreadRead",
          `mention:${authoritativeAttachment.attachment.name}:item:${authoritativeAttachment.itemId}`,
          authoritativeAttachment.itemId,
        );
        observe("v2AttachmentPreview", "appiumAndAppServer", "uploadedAndPreviewedRealBytes");

        const changeName = `v2-e2e-${nonce.slice(-12)}.txt`;
        const changeRelativePath = changeName;
        const changeAbsolutePath = path.join(REPO_ROOT, changeRelativePath);
        const changeToken = `CHANGEBODY${nonce}`;
        const changeReply = `V2CHANGEOK${nonce}`;
        const changeMessage = `Use apply_patch to create ${changeRelativePath} containing ${changeToken}, then reply exactly ${changeReply}.`;
        try {
          await appServer!.startTurn(
            threadId!,
            changeMessage,
            `e2e-v2-change-${nonce.toLowerCase()}`,
          );
          await appServer!.waitForAgentText(threadId!, changeReply, APP_SERVER_TIMEOUT_MS);
          await waitForVisibleTextContaining(driver!, changeReply);
          await openContextChip(driver!, "Changes ·");
          await assertDarkSystemBars(driver!, "changes");
          await captureRuntimeSurface(driver!, "changes-populated");
          await clickAccessibilityContaining(driver!, changeName);
          await waitForVisibleTextContaining(driver!, changeToken);
          await assertDarkSystemBars(driver!, "changes-detail");
          await captureRuntimeSurface(driver!, "changes-real-diff");
          observe("v2Changes", "appiumAndAppServer", "realDiffRendered");
          await returnToConversation(driver!);
        } finally {
          await rm(changeAbsolutePath, { force: true });
        }
      });

      await caseWithVideo(driver, "09-v2-terminal-port-browser-and-system-ui", async () => {
        await waitForAccessibility(driver!, "Message Codex");
        await clickAccessibility(driver!, "Composer menu");
        await clickVisibleText(driver!, "Terminal");
        await ensureTerminalOpen(driver!);
        const terminalMarker = path.join(os.tmpdir(), `codewide-terminal-${nonce}`);
        const terminalOutput = `TERMOUT${nonce}`;
        const reattachOutput = `REATTACH${nonce}`;
        const terminalSecret = path.join(os.tmpdir(), `codewide-terminal-secret-${nonce}`);
        await writeFile(terminalSecret, `export CODEWIDE_E2E_REATTACH=${reattachOutput}\n`, {
          mode: 0o600,
        });
        try {
          // Source the value from a mode-0600 host file so the first terminal
          // command does not echo the reattach proof token into the viewport.
          await sendTerminalCommand(
            driver!,
            `. ${terminalSecret}; rm -f ${terminalSecret}; printf '${terminalOutput}\\n'; touch ${terminalMarker}`,
          );
          await waitForPath(terminalMarker, UI_TIMEOUT_MS);
          await waitForVisibleTextContaining(driver!, terminalOutput);
          await waitForTextHidden(driver!, reattachOutput);
          await captureRuntimeSurface(driver!, "terminal-command-output");
          await resizeAndroidViewport(device!, driver!, "Terminal 1");
          await driver!.terminateApp(PACKAGE_NAME);
          await stopAndroidConnectionService(device!);
          await activateApplication(driver!, PACKAGE_NAME);
          await waitForApplicationReady(driver!);
          await waitForAccessibility(driver!, "Terminal 1");
          await sendTerminalCommand(driver!, `printf "$CODEWIDE_E2E_REATTACH\\n"`);
          await waitForVisibleTextContaining(driver!, reattachOutput);
          await captureRuntimeSurface(driver!, "terminal-reattached-output");
        } finally {
          await rm(terminalMarker, { force: true });
          await rm(terminalSecret, { force: true });
        }
        observe(
          "v2Terminal",
          "appiumAndHostFilesystem",
          "outputRenderedAndSameShellSurvivedResizeAndReattach",
        );
        await clickAccessibility(driver!, "Minimize terminal");

        await waitForAccessibility(driver!, "Message Codex");
        await clickAccessibility(driver!, "Composer menu");
        await clickVisibleText(driver!, "Port forward");
        await assertDarkSystemBars(driver!, "ports");
        await captureRuntimeSurface(driver!, "ports-available");
        await clickVisibleText(driver!, "Available");
        await clickAccessibility(driver!, "Refresh open ports");
        await clickAccessibilityContaining(driver!, `port ${fixtureWeb.port}`);
        const forwardingName = `E2E Web ${nonce.slice(-8)}`;
        const nameInput = await waitForAccessibility(driver!, "Forwarding name");
        await nameInput.clearValue();
        await nameInput.setValue(forwardingName);
        await clickAccessibility(driver!, "Save forwarding");
        await clickAccessibility(driver!, `${forwardingName}, live`);
        await waitForVisibleTextContaining(driver!, fixtureWeb.marker);
        await captureRuntimeSurface(driver!, "browser-forwarded-content");
        await clickAccessibility(driver!, "Open Chromium DevTools");
        await waitForAccessibility(driver!, "Close Chromium DevTools");
        await assertDarkSystemBars(driver!, "browser");
        await captureRuntimeSurface(driver!, "browser-devtools");
        observe("v2PortBrowser", "appiumAndLocalHttp", "forwardedWebViewAndDevToolsRendered");
        await clickAccessibility(driver!, "Close browser");
      });
    }

    await caseWithVideo(driver, "10-isolated-server-state-parity", async () => {
      await returnToThreadListSurface(driver!);
      if (TARGET_FAMILY !== "phone") {
        const { unfoldedState } = await resolveFoldStates(device!);
        await adb(device!, REPO_ROOT, ["shell", "cmd", "device_state", "state", unfoldedState]);
        currentFoldPosture = "unfolded";
        await delay(750);
      }
      await waitForAccessibility(driver!, "New thread");
      const fixture = await startEmptyServerStateFixture({
        artifactDir,
        device: device!,
        preferredDevicePort: 18_766,
        repoRoot: REPO_ROOT,
        runtimeDir: path.join(runtimeDir, "empty-server-state"),
      });
      processes.push(fixture.appServerProcess, fixture.companionProcess);
      reversePorts.push(fixture.devicePort);
      const serverNames = Array.from(
        { length: 16 },
        (_, index) => `Empty E2E ${String(index + 1).padStart(2, "0")}`,
      );
      const firstServerName = serverNames[0];
      if (firstServerName === undefined) throw new Error("Empty server fixture has no records");
      for (const serverName of serverNames) {
        const link = await fixture.createPairing(serverName);
        await openDeepLink(device!, REPO_ROOT, PACKAGE_NAME, link);
        const name = await waitForAccessibility(driver!, "Server name");
        const actualName = await name.getAttribute("text");
        if (actualName !== serverName) {
          throw new Error(`Pairing expected ${serverName}, received ${actualName}`);
        }
        await clickAccessibility(driver!, "Connect server");
        await waitForAccessibility(driver!, "New thread");
      }
      const primaryRecordCount = VISUAL_PARITY_ONLY ? 2 : 1;
      for (let index = 0; index < primaryRecordCount; index += 1) {
        await deleteSavedServer(driver!, "CodeWide E2E");
      }
      const catalogLayout: VisualParityLayout = TARGET_FAMILY === "phone" ? "phone" : "wide";
      await captureEmptyAndMultipleServerStates(
        driver!,
        device!,
        "v2",
        serverNames,
        catalogLayout,
      );
      if (!process.argv.includes("--v2-only")) {
        await switchUiGenerationFromThreadList(driver!, "v1");
        await captureEmptyAndMultipleServerStates(
          driver!,
          device!,
          "v1",
          serverNames,
          catalogLayout,
        );
        await switchUiGenerationFromThreadList(driver!, "v2");
      }
      await fixture.revokeAllDevices();
      await reconnectAndroidConnectionServiceInPlace(device!);
      await capturePhoneServerStatusAcrossGenerations(
        driver!,
        device!,
        firstServerName,
        "Access required",
      );
      await disableSavedServer(driver!, firstServerName);
      await capturePhoneServerStatusAcrossGenerations(
        driver!,
        device!,
        firstServerName,
        "Disabled",
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
    if (visualParityCaptures.size > 0 && !visualParityFinalized) {
      try {
        await finalizeVisualParityEvidence();
        visualParityFinalized = true;
      } catch (error) {
        const parityFailure = error instanceof Error ? error : new Error(String(error));
        failure = appendFailure(failure, parityFailure);
      }
    }
    if (device !== null) {
      const logcat = await captureLogcat(device, REPO_ROOT).catch(() => "");
      await writeFile(path.join(artifactDir, "logcat.txt"), filterLogcat(logcat), { mode: 0o600 });
    }
    if (appServer !== null && threadRowParityFixture !== null) {
      await cleanupThreadRowParityFixture(appServer, threadRowParityFixture).catch(() => undefined);
    }
    appServer?.close();
    if (fixtureHttpServer !== null) await closeServer(fixtureHttpServer).catch(() => undefined);
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
      for (const filePath of pushedDeviceFiles) {
        await adb(device, REPO_ROOT, ["shell", "rm", "-f", filePath], {
          allowFailure: true,
        }).catch(() => undefined);
      }
      if (previousSysuiDemoAllowed !== null) {
        await restoreGlobalSetting(device, "sysui_demo_allowed", previousSysuiDemoAllowed).catch(
          () => undefined,
        );
      }
    }
    for (const process of processes.reverse()) await process.stop();
    if (device?.emulatorProcess !== null && device?.emulatorProcess !== undefined) {
      await adb(device, REPO_ROOT, ["emu", "kill"], { allowFailure: true }).catch(() => undefined);
      await device.emulatorProcess.stop();
    }
    for (const filePath of generatedRepoFiles) await rm(filePath, { force: true });
    await removeRuntimeDir(runtimeDir);
  }

  const sourceFingerprintAfterRun = await computeSourceFingerprint(REPO_ROOT);
  try {
    requireStableSourceFingerprint(sourceFingerprintBeforeRun, sourceFingerprintAfterRun);
  } catch (error) {
    const sourceChanged = error instanceof Error ? error : new Error(String(error));
    failure =
      failure === null
        ? sourceChanged
        : new Error(`${failure.message}; ${sourceChanged.message}`, {
            cause: new AggregateError([failure, sourceChanged]),
          });
  }
  try {
    const [apkAfterRun, companionAfterRun] = await Promise.all([
      sha256File(APK_PATH),
      sha256File(COMPANION_PATH),
    ]);
    if (apkSha256 !== "") requireExpectedFingerprint("APK", apkAfterRun, apkSha256);
    if (companionSha256 !== "") {
      requireExpectedFingerprint("Companion", companionAfterRun, companionSha256);
    }
  } catch (error) {
    failure = appendFailure(failure, error instanceof Error ? error : new Error(String(error)));
  }
  const evidence: Evidence = {
    schemaVersion: 1,
    suite: VISUAL_PARITY_ONLY
      ? "visualParityOnly"
      : process.argv.includes("--v2-only")
        ? "v2Only"
        : "full",
    backend: "managedAppServer",
    buildMode: process.argv.includes("--skip-build") ? "prebuilt" : "fresh",
    completedAt: new Date().toISOString(),
    runId,
    sourceFingerprint: sourceFingerprintBeforeRun,
    passed: failure === null,
    deviceKind:
      device === null ? null : device.serial.startsWith("emulator-") ? "emulator" : "physical",
    deviceSerial: device?.serial ?? null,
    threadId,
    steps,
    observations,
    videos,
    failure: failure?.message ?? null,
  };
  const evidencePath = path.join(artifactDir, "evidence.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  if (TARGET_FAMILY !== null) {
    const shardManifest: AndroidE2eShardManifest = {
      schemaVersion: 1,
      actualAvd,
      apkSha256,
      captures: captureProvenance,
      companionSha256,
      deviceSerial: device?.serial ?? null,
      requestedAvd: ANDROID_E2E_TARGETS[TARGET_FAMILY],
      sourceFingerprint: sourceFingerprintBeforeRun,
      targetFamily: TARGET_FAMILY,
    };
    await writeFile(
      path.join(artifactDir, "capture-manifest.json"),
      `${JSON.stringify(shardManifest, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
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

function appendFailure(current: Error | null, next: Error): Error {
  if (current === null) return next;
  return new Error(`${current.message}; ${next.message}`, {
    cause: new AggregateError([current, next]),
  });
}

async function startFixtureHttpServer(marker: string): Promise<{
  marker: string;
  port: number;
  server: Server;
}> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
    });
    response.end(
      `<!doctype html><html><body style="background:#09090b;color:#fff"><h1>${marker}</h1></body></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("Localhost browser fixture did not receive a TCP port");
  }
  return { marker, port: address.port, server };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

async function openOriginalServerAndThread(
  driver: AppiumBrowser,
  threadId: string,
  marker: string,
): Promise<void> {
  const composer = await driver.$("~Message Codex");
  const expected = await driver.$(
    `android=new UiSelector().textContains("${escapeUiSelector(marker)}")`,
  );
  if (
    (await composer.isDisplayed().catch(() => false)) &&
    (await expected.isDisplayed().catch(() => false))
  ) {
    return;
  }
  const chooseServer = await driver.$("~Choose server");
  if (await chooseServer.isDisplayed().catch(() => false)) {
    await chooseServer.click();
    await selectFirstConnectedServer(driver);
  }
  await openProjectedThreadContaining(driver, marker, threadId);
}

async function captureQueueParityStates(
  driver: AppiumBrowser,
  appServer: AppServerClient,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  nonce: string,
  reopenConversation: () => Promise<void>,
): Promise<void> {
  const marker = `${layout.toUpperCase()}${nonce.slice(-8)}`;
  const copy: QueueParityCopy = {
    editedFirst: `Queue ${marker} first edited`,
    first: `Queue ${marker} first`,
    second: `Queue ${marker} second`,
    slow: `Queue ${marker} active`,
    third: `Queue ${marker} third`,
  };
  const title = `Queue parity ${layout} ${nonce.slice(-8)}`;
  const threadId = await createQueueParityThread(appServer, title);
  let slowTurnId: string | null = null;
  let primaryFailure: Error | null = null;
  try {
    await openQueueParityThread(driver, generation, layout, threadId, title);
    appServer.clearThreadNotifications(threadId);
    slowTurnId = await appServer.startTurn(
      threadId,
      `Run /bin/sh -c 'sleep 180' and then reply exactly ${copy.slow}.`,
      `e2e-queue-active-${generation}-${layout}-${nonce.toLowerCase()}`,
    );
    await waitForActiveQueueDelivery(driver, generation);
    for (const message of [copy.first, copy.second, copy.third]) {
      await sendComposerMessage(driver, message, { requireKeyboard: true });
    }
    if (await driver.isKeyboardShown()) await driver.hideKeyboard();
    await waitForQueueTrigger(driver, generation, 3);
    await assertExactVisibleText(driver, copy.first);
    await assertExactVisibleText(driver, copy.second);

    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-01",
      `${layout}-inline-queued-message`,
      async () => {
        await waitForQueueTrigger(driver, generation, 3);
        await assertExactVisibleText(driver, copy.first);
        await assertExactVisibleText(driver, copy.second);
      },
    );

    await clickQueueTrigger(driver, generation, 3);
    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-02",
      `${layout}-queue-sheet-open`,
      async () => {
        await waitForQueueSheet(driver, generation);
        await assertQueueOrder(driver, [copy.first, copy.second, copy.third]);
      },
    );

    await clickQueueRowAction(driver, copy.first, "Edit queued prompt");
    const editor = await waitForAccessibility(driver, "Queued prompt text");
    await editor.clearValue();
    await editor.setValue(copy.editedFirst);
    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-03",
      `${layout}-queue-item-edit`,
      async () => {
        const value = await editor.getText();
        if (value !== copy.editedFirst) {
          throw new Error(`Queued prompt editor contains ${JSON.stringify(value)}`);
        }
      },
    );
    await saveQueuedPrompt(driver, generation);
    await waitForQueueTextHidden(driver, copy.first);
    await assertExactQueueSheetText(driver, copy.editedFirst);

    await clickQueueRowAction(driver, copy.third, "Delete queued prompt");
    await waitForQueueTextHidden(driver, copy.third);
    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-04",
      `${layout}-queue-item-immediate-delete`,
      async () => {
        await assertQueueOrder(driver, [copy.editedFirst, copy.second]);
        const source = await driver.getPageSource();
        if (/confirm.+queued prompt|queued prompt.+confirm/iu.test(source)) {
          throw new Error("Queue deletion opened a confirmation surface instead of deleting");
        }
      },
    );

    await moveQueuedPromptLater(driver, generation, copy.editedFirst, copy.second);
    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-05",
      `${layout}-queue-reordered`,
      async () => {
        await assertQueueOrder(driver, [copy.second, copy.editedFirst]);
      },
    );

    await clickQueueRowAction(driver, copy.second, "Steer queued prompt");
    await waitForQueueTextHidden(driver, copy.second);
    await appServer.waitForUserText(threadId, copy.second, APP_SERVER_TIMEOUT_MS);
    await captureVisualParityRow(
      driver,
      generation,
      "QUEUE-06",
      `${layout}-queue-steered`,
      async () => {
        await assertExactQueueSheetText(driver, copy.editedFirst);
        await assertQueueTextAbsent(driver, copy.second);
      },
    );
  } catch (cause) {
    primaryFailure = cause instanceof Error ? cause : new Error(String(cause));
  }

  let cleanupFailure: Error | null = null;
  try {
    await cleanupQueueParityThread(
      driver,
      appServer,
      generation,
      layout,
      threadId,
      slowTurnId,
      copy,
    );
  } catch (cause) {
    cleanupFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  try {
    await reopenConversation();
    await waitForAccessibility(driver, "Message Codex");
  } catch (cause) {
    cleanupFailure = appendFailure(
      cleanupFailure,
      cause instanceof Error ? cause : new Error(String(cause)),
    );
  }
  if (primaryFailure !== null && cleanupFailure !== null) {
    throw new Error(
      `Queue parity failed: ${primaryFailure.message}; cleanup failed: ${cleanupFailure.message}`,
      { cause: new AggregateError([primaryFailure, cleanupFailure]) },
    );
  }
  if (cleanupFailure !== null) throw cleanupFailure;
  if (primaryFailure !== null) throw primaryFailure;
}

async function createQueueParityThread(appServer: AppServerClient, title: string): Promise<string> {
  const result = await appServer.request("thread/start", {
    approvalPolicy: "never",
    baseInstructions:
      "You are a bounded queue lifecycle test. When asked, run the exact read-only sleep command, then reply only with the requested token. Do not modify files.",
    cwd: REPO_ROOT,
    developerInstructions:
      "Use tools only for the requested sleep command. Do not create or edit repository content.",
    sandbox: "danger-full-access",
  });
  if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== "string") {
    throw new Error("App Server returned an invalid queue fixture thread/start response");
  }
  const threadId = result.thread.id;
  await appServer.request("thread/name/set", { name: title, threadId });
  await appServer.subscribeThread(threadId);
  return threadId;
}

async function openQueueParityThread(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  threadId: string,
  title: string,
): Promise<void> {
  if (generation === "v1") {
    await reopenLegacyThreadContaining(driver, title, layout === "phone", title);
  } else {
    await openProjectedThreadContaining(driver, title, threadId);
  }
  await waitForAccessibility(driver, "Message Codex");
}

async function waitForActiveQueueDelivery(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  if (generation === "v1") {
    await waitForAccessibility(driver, "Stop response");
    return;
  }
  await waitForAccessibility(driver, "Delivery mode: Queue");
}

async function waitForQueueTrigger(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  count: number,
) {
  const selector =
    generation === "v1"
      ? `android=new UiSelector().description("Open queue, ${count} messages")`
      : `android=new UiSelector().description("Open queued prompts, ${count} waiting")`;
  const trigger = await driver.$(selector);
  await trigger.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  return trigger;
}

async function clickQueueTrigger(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  count: number,
): Promise<void> {
  const trigger = await waitForQueueTrigger(driver, generation, count);
  await trigger.click();
  await waitForQueueSheet(driver, generation);
}

async function waitForQueueSheet(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  await waitForAccessibility(driver, generation === "v1" ? "Close queue" : "Close queued prompts");
  await waitForVisibleTextContaining(driver, "Queued prompts");
}

async function assertExactVisibleText(driver: AppiumBrowser, text: string) {
  const candidates = await driver.$$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  const displayed = [];
  for (const candidate of candidates) {
    if (await candidate.isDisplayed().catch(() => false)) displayed.push(candidate);
  }
  if (displayed.length !== 1) {
    throw new Error(
      `Expected exactly one visible queue text ${JSON.stringify(text)}, found ${displayed.length}`,
    );
  }
  return displayed[0]!;
}

async function queueSheetVerticalBounds(
  driver: AppiumBrowser,
): Promise<{ bottom: number; top: number }> {
  const sheet = await driver.$('//*[@pane-title="Bottom Sheet"]');
  await sheet.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  const [height, top] = await Promise.all([sheet.getSize("height"), sheet.getLocation("y")]);
  return { bottom: top + height, top };
}

async function exactQueueSheetTextElements(
  driver: AppiumBrowser,
  text: string,
): Promise<WebdriverIO.Element[]> {
  const bounds = await queueSheetVerticalBounds(driver);
  const candidates = await driver.$$(`android=new UiSelector().text("${escapeUiSelector(text)}")`);
  const displayed: WebdriverIO.Element[] = [];
  for (const candidate of candidates) {
    if (!(await candidate.isDisplayed().catch(() => false))) continue;
    const y = await candidate.getLocation("y");
    if (y >= bounds.top && y < bounds.bottom) displayed.push(candidate);
  }
  return displayed;
}

async function assertExactQueueSheetText(driver: AppiumBrowser, text: string) {
  const displayed = await exactQueueSheetTextElements(driver, text);
  if (displayed.length !== 1) {
    throw new Error(
      `Expected exactly one queued row ${JSON.stringify(text)}, found ${displayed.length}`,
    );
  }
  return displayed[0]!;
}

async function assertQueueTextAbsent(driver: AppiumBrowser, text: string): Promise<void> {
  const displayed = await exactQueueSheetTextElements(driver, text);
  if (displayed.length > 0) {
    throw new Error(`Queued row ${JSON.stringify(text)} is still visible`);
  }
}

async function waitForQueueTextHidden(driver: AppiumBrowser, text: string): Promise<void> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await assertQueueTextAbsent(driver, text);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Timed out waiting for exact queue text ${JSON.stringify(text)} to disappear`);
}

async function assertQueueOrder(driver: AppiumBrowser, messages: readonly string[]): Promise<void> {
  let previousY = -1;
  for (const message of messages) {
    const element = await assertExactQueueSheetText(driver, message);
    const y = await element.getLocation("y");
    if (y <= previousY) {
      throw new Error(`Queue order does not match ${messages.join(" -> ")}`);
    }
    previousY = y;
  }
}

async function clickQueueRowAction(
  driver: AppiumBrowser,
  message: string,
  actionLabel: string,
): Promise<void> {
  const rowText = await assertExactQueueSheetText(driver, message);
  const rowY = await rowText.getLocation("y");
  const candidates = await driver.$$(`~${actionLabel}`);
  let selected: { distance: number; element: WebdriverIO.Element } | null = null;
  for (const candidate of candidates) {
    if (!(await candidate.isDisplayed().catch(() => false))) continue;
    if ((await candidate.getAttribute("enabled").catch(() => "false")) !== "true") continue;
    const distance = Math.abs((await candidate.getLocation("y")) - rowY);
    if (selected === null || distance < selected.distance)
      selected = { distance, element: candidate };
  }
  if (selected === null) {
    throw new Error(`No enabled ${actionLabel} action for ${message}`);
  }
  await selected.element.click();
}

async function saveQueuedPrompt(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  if (generation === "v1") {
    await clickVisibleText(driver, "Save");
    return;
  }
  await clickAccessibility(driver, "Save queued prompt");
}

async function moveQueuedPromptLater(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  movingMessage: string,
  nextMessage: string,
): Promise<void> {
  if (generation === "v2") {
    await clickQueueRowAction(driver, movingMessage, "Move queued prompt later");
  } else {
    const moving = await assertExactQueueSheetText(driver, movingMessage);
    const next = await assertExactQueueSheetText(driver, nextMessage);
    const movingY = await moving.getLocation("y");
    const nextY = await next.getLocation("y");
    const handles = await driver.$$("~Drag queued prompt");
    let selected: { distance: number; element: WebdriverIO.Element } | null = null;
    for (const handle of handles) {
      if (!(await handle.isDisplayed().catch(() => false))) continue;
      const distance = Math.abs((await handle.getLocation("y")) - movingY);
      if (selected === null || distance < selected.distance)
        selected = { distance, element: handle };
    }
    if (selected === null) throw new Error(`No drag handle for ${movingMessage}`);
    const [height, width, x, y] = await Promise.all([
      selected.element.getSize("height"),
      selected.element.getSize("width"),
      selected.element.getLocation("x"),
      selected.element.getLocation("y"),
    ]);
    const centerX = x + Math.floor(width / 2);
    const centerY = y + Math.floor(height / 2);
    await driver
      .action("pointer", { parameters: { pointerType: "touch" } })
      .move({ duration: 0, x: centerX, y: centerY })
      .down({ button: 0 })
      .pause(250)
      .move({ duration: 650, x: centerX, y: centerY + Math.max(48, nextY - movingY) })
      .up({ button: 0 })
      .perform();
  }
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const moving = await assertExactQueueSheetText(driver, movingMessage);
    const next = await assertExactQueueSheetText(driver, nextMessage);
    if ((await next.getLocation("y")) < (await moving.getLocation("y"))) return;
    await delay(250);
  }
  throw new Error(`Queued prompt ${movingMessage} did not move after ${nextMessage}`);
}

async function cleanupQueueParityThread(
  driver: AppiumBrowser,
  appServer: AppServerClient,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  threadId: string,
  slowTurnId: string | null,
  copy: QueueParityCopy,
): Promise<void> {
  const editor = await driver.$("~Queued prompt text");
  if (await editor.isDisplayed().catch(() => false)) {
    if (generation === "v1") await clickVisibleText(driver, "Cancel");
    else await clickAccessibility(driver, "Cancel queued prompt edit");
  }
  const closeLabel = generation === "v1" ? "Close queue" : "Close queued prompts";
  const close = await driver.$(`~${closeLabel}`);
  let queueSheetOpen = await close.isDisplayed().catch(() => false);
  if (!queueSheetOpen) {
    const trigger = await driver.$(
      generation === "v1"
        ? 'android=new UiSelector().descriptionStartsWith("Open queue, ")'
        : 'android=new UiSelector().descriptionStartsWith("Open queued prompts, ")',
    );
    if (await trigger.isDisplayed().catch(() => false)) {
      await trigger.click();
      await waitForQueueSheet(driver, generation);
      queueSheetOpen = true;
    }
  }
  if (queueSheetOpen) {
    for (const message of [copy.first, copy.editedFirst, copy.second, copy.third]) {
      const candidates = await exactQueueSheetTextElements(driver, message);
      if (candidates.length === 0) continue;
      await clickQueueRowAction(driver, message, "Delete queued prompt");
      await waitForQueueTextHidden(driver, message);
    }
  }
  const visibleClose = await driver.$(`~${closeLabel}`);
  if (await visibleClose.isDisplayed().catch(() => false)) await visibleClose.click();
  if (slowTurnId !== null) {
    await appServer.request("turn/interrupt", { threadId, turnId: slowTurnId });
    await appServer.waitForThreadNotificationSequence(
      threadId,
      [{ method: "turn/completed", turnId: slowTurnId }],
      30_000,
    );
  }
  await appServer.request("thread/archive", { threadId });
  if (layout === "phone") {
    const newThread = await driver.$("~New thread");
    if (!(await newThread.isDisplayed().catch(() => false))) {
      const back = await driver.$("~Back to threads");
      if (await back.isDisplayed().catch(() => false)) await back.click();
      else await driver.back();
    }
    await waitForAccessibility(driver, "New thread");
  }
}

async function assertQueuedPrompts(
  driver: AppiumBrowser,
  messages: readonly [string, string],
  surface: string,
): Promise<void> {
  const trigger = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Open queued prompts, ")',
  );
  await trigger.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await trigger.click();
  await assertDarkSystemBars(driver, surface);
  for (const message of messages) await waitForVisibleTextContaining(driver, message);
  await delay(300);
  const rows = [];
  for (const message of messages) {
    const candidates = await driver.$$(
      `android=new UiSelector().text("${escapeUiSelector(message)}")`,
    );
    const displayed = [];
    for (const candidate of candidates) {
      if (await candidate.isDisplayed().catch(() => false)) displayed.push(candidate);
    }
    if (displayed.length !== 1) {
      throw new Error(`Expected one queued prompt row for ${message}, found ${displayed.length}`);
    }
    rows.push({ message, y: await displayed[0]!.getLocation("y") });
  }
  if (rows[0]!.y >= rows[1]!.y) {
    throw new Error("Queued prompts were not rendered in FIFO order");
  }
  await clickAccessibility(driver, "Close queued prompts");
  await waitForAccessibility(driver, "Message Codex");
}

async function clearTurnNotifications(driver: AppiumBrowser): Promise<void> {
  await driver.openNotifications();
  for (const title of ["Codex turn completed", "Codex turn failed"]) {
    const rows = await codeWideNotificationRows(driver, title);
    for (const row of rows) {
      const [height, width, x, y, window] = await Promise.all([
        row.getSize("height"),
        row.getSize("width"),
        row.getLocation("x"),
        row.getLocation("y"),
        driver.getWindowSize(),
      ]);
      await driver.execute("mobile: swipeGesture", {
        direction: "left",
        height: Math.max(1, height),
        left: Math.max(0, x),
        percent: 0.95,
        top: Math.max(0, y),
        width: Math.min(width, window.width),
      });
    }
    if (rows.length > 0) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if ((await codeWideNotificationRows(driver, title)).length === 0) break;
        await delay(100);
      }
      const remaining = await codeWideNotificationRows(driver, title);
      if (remaining.length > 0) {
        throw new Error(`Could not dismiss only CodeWide notifications titled ${title}`);
      }
    }
  }
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");
}

async function openSingleTurnNotification(
  driver: AppiumBrowser,
  title: string,
  artifactSuffix: string,
): Promise<void> {
  await driver.openNotifications();
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await codeWideNotificationRows(driver, title);
    if (rows.length > 1) {
      throw new Error(`Expected one exact CodeWide notification ${title}, found ${rows.length}`);
    }
    if (rows.length === 1) {
      await Promise.all([
        driver.saveScreenshot(
          path.join(artifactDir, `v2-notification-deep-link-${artifactSuffix}.png`),
        ),
        driver
          .getPageSource()
          .then((source) =>
            writeFile(
              path.join(artifactDir, `v2-notification-deep-link-${artifactSuffix}.xml`),
              source,
              { mode: 0o600 },
            ),
          ),
      ]);
      await rows[0]!.click();
      return;
    }
    await delay(250);
  }
  throw new Error(`CodeWide notification did not appear: ${title}`);
}

async function codeWideNotificationRows(driver: AppiumBrowser, title: string) {
  const selector =
    `//*[contains(@resource-id,"expandableNotificationRow")]` +
    `[.//*[contains(@resource-id,"app_name_text") and @text="CodeWide"]` +
    ` and .//*[@text="${title}"]]`;
  const candidates = await driver.$$(selector);
  const displayed = [];
  for (const candidate of candidates) {
    if (await candidate.isDisplayed().catch(() => false)) displayed.push(candidate);
  }
  return displayed;
}

async function waitForVisibleTextWithinBudget(
  driver: AppiumBrowser,
  text: string,
  startedAtMs: number,
  budgetMs: number,
): Promise<number> {
  const deadline = startedAtMs + budgetMs;
  const element = await driver.$(
    `android=new UiSelector().textContains("${escapeUiSelector(text)}")`,
  );
  while (Date.now() <= deadline) {
    if (await element.isDisplayed().catch(() => false)) return Date.now() - startedAtMs;
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error(
    `V2 partial text missed the ${budgetMs} ms App Server delta-to-UI latency budget: ${text}`,
  );
}

async function chooseAndroidDocument(driver: AppiumBrowser, name: string): Promise<void> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const file = await driver.$(
      `android=new UiSelector().textContains("${escapeUiSelector(name)}")`,
    );
    if (await file.isDisplayed().catch(() => false)) {
      await file.click();
      await waitForAccessibility(driver, "Draft attachments");
      return;
    }
    const downloads = await driver.$('android=new UiSelector().text("Downloads")');
    if (await downloads.isDisplayed().catch(() => false)) {
      await downloads.click();
      await delay(250);
      continue;
    }
    await delay(250);
  }
  throw new Error(`Android document picker did not expose ${name}`);
}

async function clickAccessibilityContaining(
  driver: AppiumBrowser,
  fragment: string,
): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionContains("${escapeUiSelector(fragment)}")`,
  );
  await element.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await element.click();
}

async function openContextChip(driver: AppiumBrowser, prefix: string): Promise<void> {
  const element = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(prefix)}")`,
  );
  await element.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await element.click();
}

async function returnToConversation(driver: AppiumBrowser): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const composer = await driver.$("~Message Codex");
    if (await composer.isDisplayed().catch(() => false)) return;
    await driver.back();
    await delay(250);
  }
  await waitForAccessibility(driver, "Message Codex");
}

async function sendTerminalCommand(driver: AppiumBrowser, command: string): Promise<void> {
  const { height, width } = await driver.getWindowSize();
  await driver.execute("mobile: clickGesture", {
    x: Math.floor(width / 2),
    y: Math.floor(height / 2),
  });
  await driver.keys(command);
  await driver.pressKeyCode(66);
}

async function ensureTerminalOpen(driver: AppiumBrowser): Promise<void> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const terminal = await driver.$("~Terminal 1");
    if (await terminal.isDisplayed().catch(() => false)) return;
    const open = await driver.$("~Open terminal");
    if (await open.isDisplayed().catch(() => false)) {
      await open.click();
    }
    await delay(250);
  }
  throw new Error("V2 terminal did not open");
}

async function waitForPath(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`Terminal command did not create ${filePath}`);
}

async function resizeAndroidViewport(
  device: AndroidDevice,
  driver: AppiumBrowser,
  expectedAccessibility: string,
): Promise<void> {
  if (TARGET_FAMILY === "phone") {
    await waitForAccessibility(driver, expectedAccessibility);
    if (expectedAccessibility === "Message Codex" && (await driver.isKeyboardShown())) {
      await assertComposerAboveIme(driver, "phone");
    }
    return;
  }
  const before = await driver.getWindowSize();
  const keyboardWasOpen = await driver.isKeyboardShown();
  if (expectedAccessibility === "Message Codex") {
    await assertComposerAboveIme(driver, "before-fold");
  }
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  const folded = await transitionFoldableState(device, driver, foldedState, before);
  await waitForAccessibility(driver, expectedAccessibility);
  if (keyboardWasOpen && !(await driver.isKeyboardShown())) {
    throw new Error("The Android IME closed while the foldable entered its CLOSED state");
  }
  if (expectedAccessibility === "Message Codex") {
    await assertComposerAboveIme(driver, "folded");
  }
  const unfolded = await transitionFoldableState(device, driver, unfoldedState, folded);
  await waitForAccessibility(driver, expectedAccessibility);
  if (keyboardWasOpen && !(await driver.isKeyboardShown())) {
    throw new Error("The Android IME closed while the foldable returned to its OPENED state");
  }
  if (expectedAccessibility === "Message Codex") {
    await assertComposerAboveIme(driver, "unfolded");
  }
  if (unfolded.width !== before.width || unfolded.height !== before.height) {
    throw new Error(
      `Foldable viewport did not return to ${before.width}x${before.height}; received ${unfolded.width}x${unfolded.height}`,
    );
  }
}

async function assertComposerAboveIme(driver: AppiumBrowser, state: string): Promise<void> {
  if (!(await driver.isKeyboardShown())) {
    throw new Error(`Android IME is not visible during composer geometry check: ${state}`);
  }
  const [composer, viewport, source] = await Promise.all([
    waitForAccessibility(driver, "Message Codex"),
    driver.getWindowSize(),
    driver.getPageSource(),
  ]);
  const [composerX, composerY, composerWidth, composerHeight] = await Promise.all([
    composer.getLocation("x"),
    composer.getLocation("y"),
    composer.getSize("width"),
    composer.getSize("height"),
  ]);
  const imeRects: Array<{ height: number; width: number; x: number; y: number }> = [];
  for (const [node] of source.matchAll(/<node\b[^>]*>/gu)) {
    const packageName = /\bpackage="([^"]+)"/u.exec(node)?.[1] ?? "";
    if (!/(?:inputmethod|honeyboard|keyboard|swiftkey)/iu.test(packageName)) continue;
    const bounds = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
    if (bounds === null) continue;
    const [x, y, right, boundsBottom] = bounds.slice(1).map(Number);
    if (x === undefined || y === undefined || right === undefined || boundsBottom === undefined)
      continue;
    const width = right - x;
    const height = boundsBottom - y;
    if (height > 0 && y > viewport.height * 0.15 && boundsBottom >= viewport.height * 0.75) {
      imeRects.push({ height, width, x, y });
    }
  }
  const imeTop = Math.min(...imeRects.map(({ y }) => y));
  if (!Number.isFinite(imeTop)) {
    throw new Error("Could not resolve the visible Android IME bounds from accessibility data");
  }
  const composerBottom = composerY + composerHeight;
  if (composerBottom > imeTop) {
    throw new Error(
      `Composer overlaps the Android IME during ${state}: composer bottom ${composerBottom}, IME top ${imeTop}`,
    );
  }
  await captureRuntimeSurface(driver, `composer-ime-${state}`);
  observe(
    "v2KeyboardComposerGeometry",
    "appiumAccessibilityBounds",
    `state:${state}:composer:${composerX},${composerY},${composerWidth}x${composerHeight}:imeTop:${imeTop}`,
  );
}

async function transitionFoldableState(
  device: AndroidDevice,
  driver: AppiumBrowser,
  state: string,
  previous: { height: number; width: number },
): Promise<{ height: number; width: number }> {
  if (TARGET_FAMILY === "phone") {
    throw new Error("Phone Android E2E shard must not call fold/device_state controls");
  }
  await adb(device, REPO_ROOT, ["shell", "cmd", "device_state", "state", state]);
  const current = await waitForWindowSizeChange(driver, previous);
  currentFoldPosture = current.width * current.height < previous.width * previous.height
    ? "folded"
    : "unfolded";
  return current;
}

async function resolveFoldStates(
  device: AndroidDevice,
): Promise<{ foldedState: string; unfoldedState: string }> {
  const configuredFolded = process.env.CODEWIDE_E2E_FOLDED_STATE?.trim();
  const configuredUnfolded = process.env.CODEWIDE_E2E_UNFOLDED_STATE?.trim();
  if (
    configuredFolded !== undefined &&
    configuredFolded !== "" &&
    configuredUnfolded !== undefined &&
    configuredUnfolded !== ""
  ) {
    return { foldedState: configuredFolded, unfoldedState: configuredUnfolded };
  }
  if ((configuredFolded ?? "") !== "" || (configuredUnfolded ?? "") !== "") {
    throw new Error(
      "CODEWIDE_E2E_FOLDED_STATE and CODEWIDE_E2E_UNFOLDED_STATE must be provided together",
    );
  }
  const supported = await adb(device, REPO_ROOT, ["shell", "cmd", "device_state", "print-states"]);
  const foldedState = readNamedDeviceState(supported, "CLOSED");
  const unfoldedState = readNamedDeviceState(supported, "OPENED");
  if (foldedState === null || unfoldedState === null) {
    throw new Error(
      "Android E2E requires a real foldable with CLOSED and OPENED device states; rotation is not fold evidence",
    );
  }
  return { foldedState, unfoldedState };
}

function readNamedDeviceState(output: string, name: string): string | null {
  const match = new RegExp(`identifier=(\\d+), name='${name}'`, "u").exec(output);
  return match?.[1] ?? null;
}

async function waitForWindowSizeChange(
  driver: AppiumBrowser,
  previous: { height: number; width: number },
): Promise<{ height: number; width: number }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await driver.getWindowSize();
    if (current.width !== previous.width || current.height !== previous.height) return current;
    await delay(100);
  }
  throw new Error(
    `Foldable viewport stayed at ${previous.width}x${previous.height} after device-state transition`,
  );
}

async function assertDarkSystemBars(driver: AppiumBrowser, surface: string): Promise<void> {
  const screenshotPath = path.join(artifactDir, `v2-dark-system-bars-${surface}.png`);
  await driver.saveScreenshot(screenshotPath);
  const [statusBar, navigationBar] = await Promise.all([
    readEdgeLuminance(screenshotPath, "top", 0.025),
    readEdgeLuminance(screenshotPath, "bottom", 0.04),
  ]);
  if (statusBar > 80 || navigationBar > 80) {
    throw new Error(
      `Android system bars are not dark (status ${statusBar.toFixed(1)}, navigation ${navigationBar.toFixed(1)})`,
    );
  }
}

async function captureRuntimeSurface(driver: AppiumBrowser, surface: string): Promise<void> {
  const prefix = `v2-runtime-${surface}`;
  await Promise.all([
    driver.saveScreenshot(path.join(artifactDir, `${prefix}.png`)),
    driver
      .getPageSource()
      .then((source) =>
        writeFile(path.join(artifactDir, `${prefix}.xml`), source, { mode: 0o600 }),
      ),
  ]);
}

function v2ThreadMarker(nonce: string): string {
  return `V2FEATUREOK${nonce}`;
}

function escapeUiSelector(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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
    const companionDataDirectory = path.join(runtimeDir, "data");
    const vcsRegistry = path.join(companionDataDirectory, "vcs-plugins.json");
    const controlEndpoint = path.join(runtimeDir, "control.sock");
    const tokenFile = path.join(runtimeDir, "host.token");
    await mkdir(companionDataDirectory, { recursive: true, mode: 0o700 });
    const projectTimestamp = Date.now();
    await writeFile(
      path.join(companionDataDirectory, "projects.json"),
      `${JSON.stringify(
        {
          projects: [
            {
              addedAt: projectTimestamp,
              lastUsedAt: projectTimestamp,
              name: path.basename(REPO_ROOT),
              path: REPO_ROOT,
              pinned: true,
            },
          ],
          version: 1,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    await runCommand(
      companionBinary,
      [
        "vcs",
        "plugin",
        "install",
        "--id",
        "git",
        "--executable",
        path.join(REPO_ROOT, "target", "debug", "codewide-vcs-git"),
        "--priority=-1000",
        "--registry",
        vcsRegistry,
      ],
      { cwd: REPO_ROOT },
    );
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
        companionDataDirectory,
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
      COMPANION_PATH,
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
  assertionText: string;
  label: string;
  rowId: string;
  state: string;
};

type VisualParityRowCapture = {
  rowId: string;
  state: string;
  v1?: { screenshot: string; xml: string };
  v2?: { screenshot: string; xml: string };
};

type ParityAgentFixture = {
  childReply: string;
  childThreadId: string;
  parentReply: string;
  parentThreadId: string;
  parentTitle: string;
};

type QueueParityCopy = {
  editedFirst: string;
  first: string;
  second: string;
  slow: string;
  third: string;
};

async function openAddServerFromCurrentSurface(driver: AppiumBrowser): Promise<void> {
  let addServer = await driver.$("~Add server");
  if (!(await addServer.isDisplayed().catch(() => false))) {
    const back = await driver.$("~Back to threads");
    if (await back.isDisplayed().catch(() => false)) await back.click();
    const chooseServer = await driver.$("~Choose server");
    if (await chooseServer.isDisplayed().catch(() => false)) await chooseServer.click();
    addServer = await driver.$("~Add server");
    await addServer.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  }
  await addServer.click();
  await waitForAccessibility(driver, "Paste connection link");
}

async function clickPasteConnectionLink(driver: AppiumBrowser): Promise<void> {
  await clickAccessibility(driver, "Paste connection link");
  if ((await driver.getCurrentPackage()) !== "com.google.android.gms") return;
  await driver.back();
  await waitForAccessibility(driver, "Paste connection link");
  await clickAccessibility(driver, "Paste connection link");
}

async function captureManualPairingParityState(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
): Promise<void> {
  if (TARGET_FAMILY !== null) {
    await captureManualPairingForLayout(
      driver,
      device,
      generation,
      TARGET_FAMILY === "phone" ? "phone" : "wide",
    );
    return;
  }
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  await adb(device, REPO_ROOT, ["shell", "cmd", "device_state", "state", unfoldedState]);
  await delay(750);
  const opened = await driver.getWindowSize();
  const folded = await transitionFoldableState(device, driver, foldedState, opened);
  await waitForAccessibility(driver, "Paste connection link");
  await driver.execute("mobile: setClipboard", {
    content: Buffer.from("not-a-codewide-pairing-link").toString("base64"),
    contentType: "plaintext",
  });
  await clickPasteConnectionLink(driver);
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-05",
    "phone-pairing-invalid-link",
    async () => {
      await waitForVisibleTextContaining(driver, "This is not a CodeWide connection code");
    },
  );
  await adb(
    device,
    REPO_ROOT,
    ["shell", "pm", "revoke", PACKAGE_NAME, "android.permission.CAMERA"],
    { allowFailure: true },
  );
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  const scanPairingQr = await driver.$("~Scan pairing QR");
  if (!(await scanPairingQr.isDisplayed().catch(() => false))) {
    await openAddServerFromCurrentSurface(driver);
  }
  await clickAccessibility(driver, "Scan pairing QR");
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-02",
    "phone-pairing-qr-permission-prompt",
    async () => {
      const permissionController = await driver.$(
        'android=new UiSelector().resourceIdMatches("com\\.android\\.permissioncontroller:id/permission_(?:message|allow_foreground_only_button|allow_button)")',
      );
      await permissionController.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await allowAndroidCameraPermission(driver);
  await waitForAccessibility(driver, "Close QR scanner");
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-03",
    "phone-pairing-qr-scanner-active",
    async () => {
      await waitForAccessibility(driver, "Close QR scanner");
      const source = await driver.getPageSource();
      if (source.includes("Camera permission is required") || source.includes("Starting camera")) {
        throw new Error("QR scanner did not reach its active camera state");
      }
    },
  );
  const closeScanner = await driver.$("~Close QR scanner");
  if (await closeScanner.isDisplayed().catch(() => false)) await closeScanner.click();
  await waitForAccessibility(driver, "Paste connection link");
  await scrollAccessibilityIntoView(driver, "Open manual server setup");
  await clickAccessibility(driver, "Open manual server setup");
  await captureVisualParityRow(driver, generation, "PAIR-01", "phone-pairing-manual-entry", () =>
    assertManualPairingEntry(driver),
  );
  await clickAccessibility(driver, "Back to connection methods");
  await waitForAccessibility(driver, "Paste connection link");
  await transitionFoldableState(device, driver, unfoldedState, folded);
  await waitForAccessibility(driver, "Paste connection link");
  await driver.execute("mobile: setClipboard", {
    content: Buffer.from("not-a-codewide-pairing-link").toString("base64"),
    contentType: "plaintext",
  });
  await clickPasteConnectionLink(driver);
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-05",
    "wide-pairing-invalid-link",
    async () => {
      await waitForVisibleTextContaining(driver, "This is not a CodeWide connection code");
    },
  );
  await scrollAccessibilityIntoView(driver, "Open manual server setup");
  await clickAccessibility(driver, "Open manual server setup");
  await captureVisualParityRow(driver, generation, "PAIR-01", "wide-pairing-manual-entry", () =>
    assertManualPairingEntry(driver),
  );
  await clickAccessibility(driver, "Back to connection methods");
  await waitForAccessibility(driver, "Paste connection link");
}

async function captureManualPairingForLayout(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await waitForAccessibility(driver, "Paste connection link");
  await driver.execute("mobile: setClipboard", {
    content: Buffer.from("not-a-codewide-pairing-link").toString("base64"),
    contentType: "plaintext",
  });
  await clickPasteConnectionLink(driver);
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-05",
    `${layout}-pairing-invalid-link`,
    async () => {
      await waitForVisibleTextContaining(driver, "This is not a CodeWide connection code");
    },
  );
  if (layout === "phone") {
    await adb(
      device,
      REPO_ROOT,
      ["shell", "pm", "revoke", PACKAGE_NAME, "android.permission.CAMERA"],
      { allowFailure: true },
    );
    await activateApplication(driver, PACKAGE_NAME);
    await waitForApplicationReady(driver);
    const scanPairingQr = await driver.$("~Scan pairing QR");
    if (!(await scanPairingQr.isDisplayed().catch(() => false))) {
      await openAddServerFromCurrentSurface(driver);
    }
    await clickAccessibility(driver, "Scan pairing QR");
    await captureVisualParityRow(
      driver,
      generation,
      "PAIR-02",
      "phone-pairing-qr-permission-prompt",
      async () => {
        const permissionController = await driver.$(
          'android=new UiSelector().resourceIdMatches("com\\.android\\.permissioncontroller:id/permission_(?:message|allow_foreground_only_button|allow_button)")',
        );
        await permissionController.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    await allowAndroidCameraPermission(driver);
    await waitForAccessibility(driver, "Close QR scanner");
    await captureVisualParityRow(
      driver,
      generation,
      "PAIR-03",
      "phone-pairing-qr-scanner-active",
      async () => {
        await waitForAccessibility(driver, "Close QR scanner");
        const source = await driver.getPageSource();
        if (source.includes("Camera permission is required") || source.includes("Starting camera")) {
          throw new Error("QR scanner did not reach its active camera state");
        }
      },
    );
    const closeScanner = await driver.$("~Close QR scanner");
    if (await closeScanner.isDisplayed().catch(() => false)) await closeScanner.click();
    await waitForAccessibility(driver, "Paste connection link");
  }
  await scrollAccessibilityIntoView(driver, "Open manual server setup");
  await clickAccessibility(driver, "Open manual server setup");
  await captureVisualParityRow(driver, generation, "PAIR-01", `${layout}-pairing-manual-entry`, () =>
    assertManualPairingEntry(driver),
  );
  await clickAccessibility(driver, "Back to connection methods");
  await waitForAccessibility(driver, "Paste connection link");
}

async function captureZeroServerParityAcrossGenerations(
  driver: AppiumBrowser,
  device: AndroidDevice,
): Promise<void> {
  if (TARGET_FAMILY !== null) {
    const layout = TARGET_FAMILY === "phone" ? "phone" : "wide";
    const captureGeneration = async (generation: VisualGeneration): Promise<void> => {
      await captureZeroServerNavigationParity({
        capture: (rowId, state, assertion) =>
          captureVisualParityRow(driver, generation, rowId, state, assertion),
        driver,
        generation,
        layout,
        timeoutMs: UI_TIMEOUT_MS,
      });
    };
    await captureGeneration("v1");
    await clickAccessibility(driver, "Settings");
    await clickAccessibility(driver, "Use V2 interface");
    await waitForApplicationReady(driver);
    await captureGeneration("v2");
    await clickAccessibility(driver, "Settings");
    await clickAccessibility(driver, "Use legacy interface");
    await waitForApplicationReady(driver);
    await waitForAccessibility(driver, "New thread");
    return;
  }
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  await adb(device, REPO_ROOT, ["shell", "cmd", "device_state", "state", unfoldedState]);
  await delay(750);
  const initialViewport = await driver.getWindowSize();
  const captureGeneration = async (generation: VisualGeneration): Promise<void> => {
    await captureZeroServerNavigationParity({
      capture: (rowId, state, assertion) =>
        captureVisualParityRow(driver, generation, rowId, state, assertion),
      driver,
      generation,
      layout: "wide",
      timeoutMs: UI_TIMEOUT_MS,
    });
    const folded = await transitionFoldableState(device, driver, foldedState, initialViewport);
    await waitForAccessibility(driver, "New thread");
    await captureZeroServerNavigationParity({
      capture: (rowId, state, assertion) =>
        captureVisualParityRow(driver, generation, rowId, state, assertion),
      driver,
      generation,
      layout: "phone",
      timeoutMs: UI_TIMEOUT_MS,
    });
    const restored = await transitionFoldableState(device, driver, unfoldedState, folded);
    if (restored.width !== initialViewport.width || restored.height !== initialViewport.height) {
      throw new Error("Zero-server parity did not restore the original unfolded viewport");
    }
    await waitForAccessibility(driver, "New thread");
  };

  await captureGeneration("v1");
  await clickAccessibility(driver, "Settings");
  await clickAccessibility(driver, "Use V2 interface");
  await waitForApplicationReady(driver);
  await captureGeneration("v2");
  await clickAccessibility(driver, "Settings");
  await clickAccessibility(driver, "Use legacy interface");
  await waitForApplicationReady(driver);
  await waitForAccessibility(driver, "New thread");
}

async function captureEmptyAndMultipleServerStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  serverNames: readonly string[],
  layout: VisualParityLayout,
): Promise<void> {
  const firstServer = serverNames[0];
  if (firstServer === undefined) throw new Error("Empty-server parity fixture has no records");
  const capture = (rowId: string, state: string, assertion: () => Promise<void>) =>
    captureVisualParityRow(driver, generation, rowId, state, assertion);
  await captureEmptyCatalogNavigationParity({
    capture,
    driver,
    generation,
    layout,
    serverName: firstServer,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureMultipleServerRailParity({
    capture,
    driver,
    generation,
    layout,
    orderedServerNames: serverNames,
    timeoutMs: UI_TIMEOUT_MS,
  });
  if (TARGET_FAMILY !== null) return;
  const opened = await driver.getWindowSize();
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  const folded = await transitionFoldableState(device, driver, foldedState, opened);
  await waitForAccessibility(driver, "New thread");
  await captureEmptyCatalogNavigationParity({
    capture,
    driver,
    generation,
    layout: "phone",
    serverName: firstServer,
    timeoutMs: UI_TIMEOUT_MS,
  });
  const restored = await transitionFoldableState(device, driver, unfoldedState, folded);
  if (restored.width !== opened.width || restored.height !== opened.height) {
    throw new Error("Empty-server parity did not restore the original unfolded viewport");
  }
  await waitForAccessibility(driver, "New thread");
}

async function disableSavedServer(driver: AppiumBrowser, serverName: string): Promise<void> {
  const back = await driver.$("~Back to threads");
  if (await back.isDisplayed().catch(() => false)) {
    await back.click();
    await waitForAccessibility(driver, "New thread");
  }
  let settings = await driver.$("~Settings");
  if (!(await settings.isDisplayed().catch(() => false))) {
    await clickAccessibility(driver, "Choose server");
    settings = await waitForAccessibility(driver, "Settings");
  }
  await settings.click();
  await waitForAccessibility(driver, "Close server settings");
  await scrollAccessibilityIntoView(driver, `Enable ${serverName}`);
  const enabled = await waitForAccessibility(driver, `Enable ${serverName}`);
  if ((await enabled.getAttribute("checked")) !== "false") await enabled.click();
  await clickAccessibility(driver, "Close server settings");
  await waitForAccessibility(driver, "New thread");
}

async function returnToThreadListSurface(driver: AppiumBrowser): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const newThread = await driver.$("~New thread");
    if (await newThread.isDisplayed().catch(() => false)) return;
    const back = await driver.$("~Back to threads");
    if (await back.isDisplayed().catch(() => false)) await back.click();
    else await driver.back();
    await delay(250);
  }
  await waitForAccessibility(driver, "New thread");
}

async function deleteSavedServer(driver: AppiumBrowser, serverName: string): Promise<void> {
  const back = await driver.$("~Back to threads");
  if (await back.isDisplayed().catch(() => false)) {
    await back.click();
    await waitForAccessibility(driver, "New thread");
  }
  let settings = await driver.$("~Settings");
  if (!(await settings.isDisplayed().catch(() => false))) {
    await clickAccessibility(driver, "Choose server");
    settings = await waitForAccessibility(driver, "Settings");
  }
  await settings.click();
  await waitForAccessibility(driver, "Close server settings");
  await scrollAccessibilityIntoView(driver, `Actions for ${serverName}`);
  await clickAccessibility(driver, `Actions for ${serverName}`);
  await clickVisibleText(driver, "Delete server");
  await clickAccessibility(driver, "Confirm delete server");
  const close = await driver.$("~Close server settings");
  if (await close.isDisplayed().catch(() => false)) await close.click();
  await waitForAccessibility(driver, "New thread");
}

async function capturePhoneServerStatusAcrossGenerations(
  driver: AppiumBrowser,
  device: AndroidDevice,
  serverName: string,
  status: "Access required" | "Disabled",
): Promise<void> {
  const opened = await driver.getWindowSize();
  const captureGeneration = async (generation: VisualGeneration): Promise<void> => {
    const foldStates = TARGET_FAMILY === "phone" ? null : await resolveFoldStates(device);
    const folded = foldStates === null
      ? null
      : await transitionFoldableState(device, driver, foldStates.foldedState, opened);
    await waitForAccessibility(driver, "New thread");
    await captureServerStatusParity({
      capture: (rowId, state, assertion) =>
        captureVisualParityRow(driver, generation, rowId, state, assertion),
      driver,
      generation,
      layout: "phone",
      serverName,
      status,
      timeoutMs: UI_TIMEOUT_MS,
    });
    if (foldStates !== null && folded !== null) {
      const restored = await transitionFoldableState(
        device,
        driver,
        foldStates.unfoldedState,
        folded,
      );
      if (restored.width !== opened.width || restored.height !== opened.height) {
        throw new Error(`${status} parity did not restore the original unfolded viewport`);
      }
    }
    await waitForAccessibility(driver, "New thread");
  };
  await captureGeneration("v2");
  if (process.argv.includes("--v2-only")) return;
  await switchUiGenerationFromThreadList(driver, "v1");
  await captureGeneration("v1");
  await switchUiGenerationFromThreadList(driver, "v2");
}

async function switchUiGenerationFromThreadList(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  let settings = await driver.$("~Settings");
  if (!(await settings.isDisplayed().catch(() => false))) {
    await clickAccessibility(driver, "Choose server");
    settings = await waitForAccessibility(driver, "Settings");
  }
  await settings.click();
  await clickAccessibility(
    driver,
    generation === "v1" ? "Use legacy interface" : "Use V2 interface",
  );
  await delay(1_500);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await waitForAccessibility(driver, "New thread");
}

async function assertManualPairingEntry(driver: AppiumBrowser): Promise<void> {
  await Promise.all([
    waitForAccessibility(driver, "Server endpoint"),
    waitForAccessibility(driver, "One-time pairing token"),
  ]);
  await scrollAccessibilityIntoView(driver, "Connect server manually");
  await Promise.all([
    waitForAccessibility(driver, "TLS certificate pin"),
    waitForAccessibility(driver, "Connect server manually"),
  ]);
}

async function allowAndroidCameraPermission(driver: AppiumBrowser): Promise<void> {
  for (const resourceId of [
    "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
    "com.android.permissioncontroller:id/permission_allow_one_time_button",
    "com.android.permissioncontroller:id/permission_allow_button",
  ]) {
    const button = await driver.$(`android=new UiSelector().resourceId("${resourceId}")`);
    if (await button.isDisplayed().catch(() => false)) {
      await button.click();
      return;
    }
  }
  throw new Error("Android camera permission prompt has no supported allow action");
}

async function connectAndCapturePairingParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  control: SurfaceFaultControl,
  nonce: string,
): Promise<void> {
  if (TARGET_FAMILY !== null) {
    await connectAndCapturePairingForLayout(
      driver,
      generation,
      control,
      nonce,
      TARGET_FAMILY === "phone" ? "phone" : "wide",
    );
    return;
  }
  const opened = await driver.getWindowSize();
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  const folded = await transitionFoldableState(device, driver, foldedState, opened);
  await waitForAccessibility(driver, "Connect server");
  await capturePairingFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    control,
    driver,
    generation,
    layout: "phone",
    nonce,
    timeoutMs: UI_TIMEOUT_MS,
  });
  const restored = await transitionFoldableState(device, driver, unfoldedState, folded);
  if (restored.width !== opened.width || restored.height !== opened.height) {
    throw new Error("Pairing failure parity did not restore the unfolded viewport");
  }
  await waitForAccessibility(driver, "Connect server");
  await capturePairingFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    control,
    driver,
    generation,
    layout: "wide",
    nonce,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await clickAccessibility(driver, "Connect server");
  const assertPairingPending = async (): Promise<void> => {
    await waitForVisibleTextContaining(driver, "Securing this device");
  };
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-04",
    "wide-pairing-connecting-pending",
    assertPairingPending,
  );
  await capturePendingActionParity({
    action: "pairing-connect",
    assertPending: assertPairingPending,
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    driver,
    generation,
    layout: "wide",
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-07",
    "wide-pairing-success-workspace-reveal",
    async () => {
      await waitForVisibleTextContaining(driver, "Connected. Syncing your threads now.");
    },
  );
}

async function connectAndCapturePairingForLayout(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  control: SurfaceFaultControl,
  nonce: string,
  layout: VisualParityLayout,
): Promise<void> {
  await waitForAccessibility(driver, "Connect server");
  await capturePairingFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    control,
    driver,
    generation,
    layout,
    nonce,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await clickAccessibility(driver, "Connect server");
  const assertPairingPending = async (): Promise<void> => {
    await waitForVisibleTextContaining(driver, "Securing this device");
  };
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-04",
    `${layout}-pairing-connecting-pending`,
    assertPairingPending,
  );
  await capturePendingActionParity({
    action: "pairing-connect",
    assertPending: assertPairingPending,
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    driver,
    generation,
    layout,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureVisualParityRow(
    driver,
    generation,
    "PAIR-07",
    `${layout}-pairing-success-workspace-reveal`,
    async () => {
      await waitForVisibleTextContaining(driver, "Connected. Syncing your threads now.");
    },
  );
}

async function captureWideOverlayParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  await captureOverlayParityStates(driver, generation, [
    {
      assertionText: "All",
      label: "Thread filters",
      rowId: "FILTER-01",
      state: "wide-thread-filters",
    },
    {
      assertionText: "Archived threads",
      label: "Thread list menu",
      rowId: "LIST-06",
      state: "wide-thread-list-menu",
    },
    {
      assertionText: "Context",
      label: "Context usage and account limits",
      rowId: "HEADER-08",
      state: "wide-context-usage",
    },
    {
      assertionText: "Attach file",
      label: "Composer menu",
      rowId: "MENU-01",
      state: "wide-composer-menu",
    },
  ]);
  await captureComposerMenuActionParityRows(driver, generation, "wide");
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
  await captureConversationShellParityRows(driver, generation, "phone", expectedCompletedTurns);
  await captureOverlayParityStates(driver, generation, [
    {
      assertionText: "Context",
      label: "Context usage and account limits",
      rowId: "HEADER-08",
      state: "phone-context-usage",
    },
    {
      assertionText: "Attach file",
      label: "Composer menu",
      rowId: "MENU-01",
      state: "phone-composer-menu",
    },
  ]);
  await captureComposerMenuActionParityRows(driver, generation, "phone");
  await captureConversationControlParityStates(driver, generation, "phone");
}

async function captureComposerMenuActionParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await driver.hideKeyboard().catch(() => undefined);
  await clickAccessibility(driver, "Composer menu");
  const actions = [
    { label: "Attach file", rowId: "MENU-02" },
    { label: "Drawing", rowId: "MENU-03" },
    { label: "Terminal", rowId: "MENU-04" },
    { label: "Port forward", rowId: "MENU-05" },
    { label: "Skills", rowId: "MENU-06" },
    { label: "Goal", rowId: "MENU-07" },
  ] as const;
  for (const action of actions) {
    await captureVisualParityRow(
      driver,
      generation,
      action.rowId,
      `${layout}-composer-menu-${action.rowId.toLowerCase()}`,
      async () => {
        const item = await driver.$(`android=new UiSelector().text("${action.label}")`);
        await item.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
  }
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");
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
  await captureVisualParityRow(
    driver,
    generation,
    "RESP-01",
    "phone-thread-list-portrait",
    async () => {
      const viewport = await driver.getWindowSize();
      if (viewport.width >= viewport.height) {
        throw new Error(
          `Phone parity viewport is not portrait: ${viewport.width}x${viewport.height}`,
        );
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "NAV-07",
    "phone-title-selector-closed",
    async () => {
      await waitForAccessibility(driver, "Choose server");
      const addServer = await driver.$("~Add server");
      if (await addServer.isDisplayed().catch(() => false)) {
        throw new Error("Phone server selector is open during the closed-selector capture");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-04",
    "phone-new-thread-action",
    async () => {
      await waitForAccessibility(driver, "New thread");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INT-01",
    "phone-default-new-thread-control",
    async () => {
      const newThread = await waitForAccessibility(driver, "New thread");
      if (!(await newThread.isEnabled())) {
        throw new Error("Default New thread action is disabled");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-05",
    "phone-thread-list-menu-closed",
    async () => {
      await waitForAccessibility(driver, "Thread list menu");
      const archived = await driver.$('android=new UiSelector().text("Archived threads")');
      if (await archived.isDisplayed().catch(() => false)) {
        throw new Error("Thread-list menu is open during its closed-state capture");
      }
    },
  );
  await captureThreadListParityRows(driver, generation, "phone");
  await captureOverlayParityStates(driver, generation, [
    {
      assertionText: "All servers",
      label: "Choose server",
      rowId: "NAV-08",
      state: "phone-server-selector",
    },
    {
      assertionText: "All",
      label: "Thread filters",
      rowId: "FILTER-01",
      state: "phone-thread-filters",
    },
    {
      assertionText: "Archived threads",
      label: "Thread list menu",
      rowId: "LIST-06",
      state: "phone-thread-list-menu",
    },
  ]);
  await capturePhoneServerSelectorParityRows(driver, generation);
  await captureArchivedThreadListParityRows(driver, generation, "phone");
}

async function captureThreadListParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  matchingQuery = "PARITY",
): Promise<void> {
  const search = await waitForAccessibility(driver, "Search threads");
  await search.click();
  await search.setValue("");
  if (layout === "phone") {
    await captureVisualParityRow(
      driver,
      generation,
      "LIST-08",
      "phone-thread-search-focused-with-keyboard",
      async () => {
        if (!(await driver.isKeyboardShown())) {
          throw new Error("Focused phone thread search did not expose the Android IME");
        }
      },
    );
  }
  await driver.hideKeyboard().catch(() => undefined);
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-07",
    `${layout}-thread-search-empty-unfocused`,
    async () => {
      if ((await search.getText()) !== "") throw new Error("Thread search is not empty");
      if (await driver.isKeyboardShown())
        throw new Error("Thread search unexpectedly owns the IME");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-17",
    `${layout}-recent-section`,
    async () => {
      await waitForVisibleTextContaining(driver, "Recent");
    },
  );
  await search.click();
  await search.setValue(matchingQuery);
  await driver.hideKeyboard().catch(() => undefined);
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-09",
    `${layout}-thread-search-with-matches`,
    async () => {
      if ((await search.getText()) !== matchingQuery) {
        throw new Error("Thread search did not retain the exact matching query");
      }
      const noRows = await driver.$('android=new UiSelector().text("No threads found")');
      if (await noRows.isDisplayed().catch(() => false)) {
        throw new Error("Thread search expected a parity-thread match but rendered none");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "ROW-01",
    `${layout}-idle-thread-row`,
    async () => {
      const source = await driver.getPageSource();
      if (!source.toLocaleLowerCase().includes(matchingQuery.toLocaleLowerCase())) {
        throw new Error("The settled parity thread row is not visible");
      }
      if (source.includes('content-desc="Thread running"')) {
        throw new Error("The parity thread row is still running instead of idle");
      }
    },
  );
  if (layout === "wide") {
    await captureVisualParityRow(
      driver,
      generation,
      "ROW-07",
      "wide-selected-thread-row",
      async () => {
        const selected = await driver.$(
          generation === "v1"
            ? 'android=new UiSelector().resourceId("selected-thread-row")'
            : "android=new UiSelector().selected(true)",
        );
        await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "INT-03",
      "wide-selected-thread-control",
      async () => {
        const selected = await driver.$(
          generation === "v1"
            ? 'android=new UiSelector().resourceId("selected-thread-row")'
            : "android=new UiSelector().selected(true)",
        );
        await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
  }
  const noMatchQuery = "NO_MATCH_VISUAL_PARITY";
  await search.click();
  await search.setValue(noMatchQuery);
  await driver.hideKeyboard().catch(() => undefined);
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-10",
    `${layout}-thread-search-no-matches`,
    async () => {
      await waitForVisibleTextContaining(driver, "No threads found");
    },
  );
  await search.setValue("");
  await driver.hideKeyboard().catch(() => undefined);
  await captureThreadFilterParityRows(driver, generation, layout);
  await search.setValue(matchingQuery);
  await driver.hideKeyboard().catch(() => undefined);
  if (layout === "wide") await captureWideNavigationParityRows(driver, generation);
  if (layout === "wide") await captureArchivedThreadListParityRows(driver, generation, layout);
}

async function captureArchivedThreadListParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await clickAccessibility(driver, "Thread list menu");
  await clickVisibleText(driver, "Archived threads");
  await waitForVisibleTextContaining(driver, "Archived threads");
  const empty = await driver.$('android=new UiSelector().text("No archived threads")');
  const detectedState = (await empty.isDisplayed().catch(() => false)) ? "empty" : "populated";
  if (generation === "v1") parityArchivedCatalogState = detectedState;
  if (parityArchivedCatalogState !== detectedState) {
    throw new Error(
      `Archived catalog changed between V1 and V2 (${parityArchivedCatalogState ?? "unknown"} -> ${detectedState})`,
    );
  }
  const stateRowId = detectedState === "empty" ? "LIST-19" : "LIST-18";
  await captureVisualParityRow(
    driver,
    generation,
    stateRowId,
    `${layout}-archived-${detectedState}`,
    async () => {
      if (detectedState === "empty") {
        await waitForVisibleTextContaining(driver, "No archived threads");
      } else {
        const source = await driver.getPageSource();
        if (source.includes('text="No archived threads"')) {
          throw new Error("Archived populated capture rendered its empty state");
        }
      }
    },
  );
  const search = await waitForAccessibility(driver, "Search threads");
  const archivedQuery = "ARCHIVED_VISUAL_PARITY_QUERY";
  await search.click();
  await search.setValue(archivedQuery);
  await driver.hideKeyboard().catch(() => undefined);
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-20",
    `${layout}-archived-search-populated`,
    async () => {
      if ((await search.getText()) !== archivedQuery) {
        throw new Error("Archived search did not retain its exact populated query");
      }
    },
  );
  await clickAccessibility(driver, "Back to threads");
  await waitForAccessibility(driver, "New thread");
}

async function captureWideNavigationParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  const states = [
    {
      assert: async () => {
        await Promise.all([
          waitForAccessibility(driver, "CodeWide E2E, Live"),
          waitForVisibleTextContaining(driver, "Recent"),
        ]);
      },
      rowId: "NAV-06",
      state: "wide-selected-server-populated",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "CodeWide E2E, Live");
      },
      rowId: "RAIL-01",
      state: "wide-rail-live-server",
    },
    {
      assert: async () => {
        const selected = await driver.$(
          'android=new UiSelector().description("CodeWide E2E, Live").selected(true)',
        );
        await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
      rowId: "RAIL-02",
      state: "wide-rail-selected-marker",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "Add server");
      },
      rowId: "RAIL-08",
      state: "wide-rail-add-server",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "Settings");
      },
      rowId: "RAIL-09",
      state: "wide-rail-settings",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "CodeWide E2E, Live");
      },
      rowId: "LIST-01",
      state: "wide-thread-list-live-header",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "New thread");
      },
      rowId: "LIST-04",
      state: "wide-new-thread-action",
    },
    {
      assert: async () => {
        await waitForAccessibility(driver, "Thread list menu");
      },
      rowId: "LIST-05",
      state: "wide-thread-list-menu-closed",
    },
  ] as const;
  for (const row of states) {
    await captureVisualParityRow(driver, generation, row.rowId, row.state, row.assert);
  }
}

async function captureThreadFilterParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  const states = [
    { label: "Running", rowId: "FILTER-02" },
    { label: "Approval needed", rowId: "FILTER-03" },
    { label: "Unread", rowId: "FILTER-04" },
    { label: "Pinned", rowId: "FILTER-05" },
  ] as const;
  for (const state of states) {
    await clickAccessibility(driver, "Thread filters");
    await clickVisibleText(driver, state.label);
    await captureVisualParityRow(
      driver,
      generation,
      state.rowId,
      `${layout}-thread-filter-${state.rowId.toLowerCase()}`,
      async () => {
        const filter = await waitForAccessibility(driver, "Thread filters");
        if ((await filter.getAttribute("selected")) !== "true") {
          throw new Error(`${state.label} filter did not expose its selected state`);
        }
      },
    );
    if (state.rowId === "FILTER-02") {
      await captureVisualParityRow(
        driver,
        generation,
        "FILTER-06",
        `${layout}-thread-filter-active-indicator`,
        async () => {
          const filter = await waitForAccessibility(driver, "Thread filters");
          if ((await filter.getAttribute("selected")) !== "true") {
            throw new Error("Active thread-filter indicator is absent");
          }
        },
      );
    }
  }
  await clickAccessibility(driver, "Thread filters");
  await clickVisibleText(driver, "All threads");
}

async function capturePhoneServerSelectorParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  await clickAccessibility(driver, "Choose server");
  const staticRows = [
    { label: "CodeWide E2E, Live", rowId: "NAV-11" },
    { label: "Add server", rowId: "NAV-18" },
    { label: "Settings", rowId: "NAV-19" },
  ] as const;
  for (const row of staticRows) {
    await captureVisualParityRow(
      driver,
      generation,
      row.rowId,
      `phone-server-selector-${row.rowId.toLowerCase()}`,
      async () => {
        await waitForAccessibility(driver, row.label);
      },
    );
  }
  await captureVisualParityRow(
    driver,
    generation,
    "NAV-10",
    "phone-server-selector-saved-selected",
    async () => {
      const selected = await driver.$(
        'android=new UiSelector().description("CodeWide E2E, Live").selected(true)',
      );
      await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "NAV-20",
    "phone-server-selector-scrim",
    async () => {
      await Promise.all([
        waitForAccessibility(driver, "All servers"),
        waitForAccessibility(driver, "Add server"),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INT-07",
    "phone-server-selector-modal-scrim",
    async () => {
      await assertBottomSheetWithinViewport(driver);
      await Promise.all([
        waitForAccessibility(driver, "All servers"),
        waitForAccessibility(driver, "Add server"),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INT-08",
    "phone-server-selector-safe-area",
    async () => {
      await assertBottomSheetWithinViewport(driver);
    },
  );
  await clickAccessibility(driver, "All servers");
  await waitForVisibleTextContaining(driver, "All threads");
  await waitForAnyThreadRow(driver);
  await captureVisualParityRow(
    driver,
    generation,
    "NAV-04",
    "phone-all-servers-populated",
    async () => {
      await Promise.all([
        waitForVisibleTextContaining(driver, "All threads"),
        waitForAnyThreadRow(driver),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "LIST-03",
    "phone-all-servers-header-count",
    async () => {
      await waitForVisibleTextContaining(driver, "All threads");
    },
  );
  await clickAccessibility(driver, "Choose server");
  await captureVisualParityRow(
    driver,
    generation,
    "NAV-09",
    "phone-server-selector-all-selected",
    async () => {
      const selected = await driver.$(
        'android=new UiSelector().description("All servers").selected(true)',
      );
      await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await selectFirstConnectedServer(driver);
  await waitForAccessibility(driver, "New thread");
}

type AdditionalPhoneParityInput = {
  agentFixture: ParityAgentFixture;
  appServer: AppServerClient;
  companionDevicePort: number;
  companionHostPort: number;
  conversationLifecycleFixture: ConversationLifecycleParityFixture;
  device: AndroidDevice;
  driver: AppiumBrowser;
  emptyThreadId: string | null;
  emptyThreadTitle: string | null;
  expectedCompletedTurns: number;
  generation: VisualGeneration;
  nonce: string;
  reopenConversation(): Promise<void>;
  resourceFixture: ResourceParityFixture;
  threadRowFaultControl: ThreadRowParityFaultControl;
  threadRowFixture: ThreadRowParityFixture;
};

async function captureAdditionalPhoneParityStates(
  input: AdditionalPhoneParityInput,
): Promise<void> {
  await input.reopenConversation();
  await waitForAccessibility(input.driver, "Message Codex");
  await captureBootParityStates({
    activityName: ACTIVITY_NAME,
    captureRow: captureVisualParityRow,
    device: input.device,
    driver: input.driver,
    generation: input.generation,
    layout: "phone",
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    restoreReady: async () => {
      await activateApplication(input.driver, PACKAGE_NAME);
      await waitForApplicationReady(input.driver);
      await input.reopenConversation();
      await waitForVisualParityProjectionReady(input.driver, input.expectedCompletedTurns);
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureRequestDraftParityStates(
    input.driver,
    input.device,
    input.appServer,
    input.resourceFixture.control,
    input.generation,
    "phone",
    input.nonce,
    input.reopenConversation,
  );
  await captureLifecycleParityStates(
    input.driver,
    input.device,
    input.generation,
    "phone",
    input.reopenConversation,
    input.expectedCompletedTurns,
    input.companionDevicePort,
    input.companionHostPort,
  );
  await captureQueueParityStates(
    input.driver,
    input.appServer,
    input.generation,
    "phone",
    input.nonce,
    input.reopenConversation,
  );
  await captureNewThreadParityStates(
    input.driver,
    input.generation,
    "phone",
    input.nonce,
    input.resourceFixture.control,
    input.reopenConversation,
  );
  await captureSettingsParityStates(
    input.driver,
    input.device,
    input.generation,
    "phone",
    input.companionDevicePort,
    input.companionHostPort,
    input.reopenConversation,
  );
  const captureResourceRow = (
    rowId: string,
    state: string,
    assertExactState: () => Promise<void>,
  ): Promise<void> =>
    captureVisualParityRow(
      input.driver,
      input.generation,
      rowId,
      state,
      assertExactState,
    );
  const resourceInput = {
    capture: captureResourceRow,
    device: input.device,
    driver: input.driver,
    fixture: input.resourceFixture,
    generation: input.generation,
    layout: "phone" as const,
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    timeoutMs: UI_TIMEOUT_MS,
  };
  await captureAttachmentResourceParity(resourceInput);
  await captureAttachmentAndChangesStateParity(resourceInput);
  await capturePortLoadingAndErrorParity(resourceInput);
  await captureDiscoveredPortParity(resourceInput);
  await captureBoundedTunnelPolicy(resourceInput);
  await captureTerminalLoadingParity(resourceInput);
  await captureTerminalLifecycleParity(resourceInput);
  await input.driver.setOrientation("LANDSCAPE");
  await delay(500);
  await captureVisualParityRow(
    input.driver,
    input.generation,
    "RESP-02",
    "phone-landscape-conversation",
    async () => {
      const viewport = await input.driver.getWindowSize();
      if (viewport.width <= viewport.height) {
        throw new Error(
          `Phone landscape parity viewport is not landscape: ${viewport.width}x${viewport.height}`,
        );
      }
      await waitForAccessibility(input.driver, "Message Codex");
    },
  );
  await input.driver.setOrientation("PORTRAIT");
  await delay(500);
  await waitForAccessibility(input.driver, "Message Codex");
  await input.driver.back();
  await waitForAccessibility(input.driver, "New thread");
  await capturePhoneActionFailureParityStates(
    input.driver,
    input.device,
    input.generation,
    input.nonce,
    input.resourceFixture.control,
    input.companionDevicePort,
    input.companionHostPort,
    input.reopenConversation,
  );
  await captureThreadRowParityScenario(
    input.driver,
    input.device,
    input.appServer,
    input.generation,
    "phone",
    input.threadRowFixture,
    input.threadRowFaultControl,
  );
  await captureConversationLifecycleParityStates(
    input.driver,
    input.device,
    input.appServer,
    input.generation,
    "phone",
    input.conversationLifecycleFixture,
    input.threadRowFixture,
    input.threadRowFaultControl,
  );
  await clickAccessibility(input.driver, "Back to threads");
  await waitForAccessibility(input.driver, "New thread");
  await captureEmptyThreadParityState(
    input.driver,
    input.generation,
    input.emptyThreadId,
    input.emptyThreadTitle,
    input.reopenConversation,
    "phone",
  );
  await captureAgentParityStates(
    input.driver,
    input.device,
    input.generation,
    "phone",
    input.agentFixture,
    input.companionHostPort,
    input.reopenConversation,
  );
  await input.driver.back();
  await waitForAccessibility(input.driver, "New thread");
}

async function captureFoldableParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  reopenConversation: () => Promise<void>,
  expectedCompletedTurns: number,
  emptyThreadId: string | null,
  emptyThreadTitle: string | null,
  agentFixture: ParityAgentFixture,
  companionDevicePort: number,
  companionHostPort: number,
  appServer: AppServerClient,
  nonce: string,
  resourceFixture: ResourceParityFixture,
  threadRowFixture: ThreadRowParityFixture,
  threadRowFaultControl: ThreadRowParityFaultControl,
  conversationLifecycleFixture: ConversationLifecycleParityFixture,
): Promise<void> {
  const opened = await driver.getWindowSize();
  const { foldedState, unfoldedState } = await resolveFoldStates(device);
  const folded = await transitionFoldableState(device, driver, foldedState, opened);
  await waitForAccessibility(driver, "Message Codex");
  await captureVisualParityRow(driver, generation, "RESP-04", "folded-conversation", async () => {
    const viewport = await driver.getWindowSize();
    if (viewport.width !== folded.width || viewport.height !== folded.height) {
      throw new Error("Folded parity viewport changed before its dedicated capture");
    }
  });
  await captureVisualParityRow(
    driver,
    generation,
    "RESP-07",
    "unfolded-to-folded-conversation",
    async () => {
      if (folded.width === opened.width && folded.height === opened.height) {
        throw new Error("Unfolded-to-folded parity transition did not resize the viewport");
      }
    },
    "unfoldedToFolded",
  );
  if (TARGET_FAMILY === "fold") {
    const captureResourceRow = (
      rowId: string,
      state: string,
      assertExactState: () => Promise<void>,
    ): Promise<void> =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState);
    await captureTerminalFoldParity({
      capture: captureResourceRow,
      device,
      driver,
      fixture: resourceFixture,
      foldedState,
      generation,
      layout: "phone",
      packageName: PACKAGE_NAME,
      repoRoot: REPO_ROOT,
      timeoutMs: UI_TIMEOUT_MS,
      unfoldedState,
    });
    const current = await driver.getWindowSize();
    const restored = await transitionFoldableState(device, driver, unfoldedState, current);
    if (restored.width !== opened.width || restored.height !== opened.height) {
      throw new Error(
        `Foldable parity viewport did not return to ${opened.width}x${opened.height}; received ${restored.width}x${restored.height}`,
      );
    }
    await waitForAccessibility(driver, "Message Codex");
    await captureVisualParityRow(
      driver,
      generation,
      "RESP-05",
      "unfolded-conversation",
      async () => {
        const viewport = await driver.getWindowSize();
        if (viewport.width !== opened.width || viewport.height !== opened.height) {
          throw new Error("Unfolded parity viewport does not match the original viewport");
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "RESP-06",
      "folded-to-unfolded-conversation",
      async () => waitForAccessibility(driver, "Message Codex").then(() => undefined),
      "foldedToUnfolded",
    );
    return;
  }
  await captureBootParityStates({
    activityName: ACTIVITY_NAME,
    captureRow: captureVisualParityRow,
    device,
    driver,
    generation,
    layout: "phone",
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    restoreReady: async () => {
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
      await reopenConversation();
      await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
  await capturePhoneConversationParityStates(driver, device, generation, expectedCompletedTurns);
  await captureVoiceFaultParity({
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    control: resourceFixture.control,
    device,
    driver,
    generation,
    layout: "phone",
    nonce,
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    restoreConversation: async () => {
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
      await reopenConversation();
      await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
  await returnToThreadListSurface(driver);
  await waitForAccessibility(driver, "Search threads");
  await captureThreadSearchVoiceParity({
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    control: resourceFixture.control,
    device,
    driver,
    generation,
    layout: "phone",
    nonce,
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    restoreThreadList: async () => {
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
      await returnToThreadListSurface(driver);
      await waitForAccessibility(driver, "Search threads");
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
  await reopenConversation();
  await waitForAccessibility(driver, "Message Codex");
  await captureRequestDraftParityStates(
    driver,
    device,
    appServer,
    resourceFixture.control,
    generation,
    "phone",
    nonce,
    reopenConversation,
  );
  await captureLifecycleParityStates(
    driver,
    device,
    generation,
    "phone",
    reopenConversation,
    expectedCompletedTurns,
    companionDevicePort,
    companionHostPort,
  );
  await captureQueueParityStates(driver, appServer, generation, "phone", nonce, reopenConversation);
  const captureResourceRow = (
    rowId: string,
    state: string,
    assertExactState: () => Promise<void>,
  ): Promise<void> => captureVisualParityRow(driver, generation, rowId, state, assertExactState);
  const resourceInput = {
    capture: captureResourceRow,
    device,
    driver,
    fixture: resourceFixture,
    generation,
    layout: "phone" as const,
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    timeoutMs: UI_TIMEOUT_MS,
  };
  await captureAttachmentResourceParity(resourceInput);
  await captureAttachmentAndChangesStateParity(resourceInput);
  await capturePortLoadingAndErrorParity(resourceInput);
  await captureDiscoveredPortParity(resourceInput);
  await captureBoundedTunnelPolicy(resourceInput);
  await captureTerminalLoadingParity(resourceInput);
  await captureTerminalLifecycleParity(resourceInput);
  await captureTerminalFoldParity({
    ...resourceInput,
    foldedState,
    unfoldedState,
  });
  await driver.setOrientation("LANDSCAPE");
  await delay(500);
  await captureVisualParityRow(
    driver,
    generation,
    "RESP-02",
    "phone-landscape-conversation",
    async () => {
      const viewport = await driver.getWindowSize();
      if (viewport.width <= viewport.height) {
        throw new Error(
          `Phone landscape parity viewport is not landscape: ${viewport.width}x${viewport.height}`,
        );
      }
      await waitForAccessibility(driver, "Message Codex");
    },
  );
  await driver.setOrientation("PORTRAIT");
  await delay(500);
  await waitForAccessibility(driver, "Message Codex");
  await driver.back();
  await waitForAccessibility(driver, "New thread");
  await capturePhoneThreadListParityStates(driver, device, generation);
  await capturePhoneActionFailureParityStates(
    driver,
    device,
    generation,
    nonce,
    resourceFixture.control,
    companionDevicePort,
    companionHostPort,
    reopenConversation,
  );
  await captureThreadRowParityScenario(
    driver,
    device,
    appServer,
    generation,
    "phone",
    threadRowFixture,
    threadRowFaultControl,
  );
  await captureConversationLifecycleParityStates(
    driver,
    device,
    appServer,
    generation,
    "phone",
    conversationLifecycleFixture,
    threadRowFixture,
    threadRowFaultControl,
  );
  await clickAccessibility(driver, "Back to threads");
  await waitForAccessibility(driver, "New thread");
  await captureEmptyThreadParityState(
    driver,
    generation,
    emptyThreadId,
    emptyThreadTitle,
    reopenConversation,
    "phone",
  );
  await captureAgentParityStates(
    driver,
    device,
    generation,
    "phone",
    agentFixture,
    companionHostPort,
    reopenConversation,
  );
  await driver.back();
  await waitForAccessibility(driver, "New thread");
  const restored = await transitionFoldableState(device, driver, unfoldedState, folded);
  if (restored.width !== opened.width || restored.height !== opened.height) {
    throw new Error(
      `Foldable parity viewport did not return to ${opened.width}x${opened.height}; received ${restored.width}x${restored.height}`,
    );
  }
  await waitForAccessibility(driver, "New thread");
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
  await captureVisualParityRow(driver, generation, "RESP-05", "unfolded-conversation", async () => {
    const viewport = await driver.getWindowSize();
    if (viewport.width !== opened.width || viewport.height !== opened.height) {
      throw new Error("Unfolded parity viewport does not match the original viewport");
    }
  });
  await captureVisualParityRow(
    driver,
    generation,
    "RESP-06",
    "folded-to-unfolded-conversation",
    async () => {
      await waitForAccessibility(driver, "Message Codex");
    },
    "foldedToUnfolded",
  );
}

async function capturePhoneActionFailureParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  nonce: string,
  control: SurfaceFaultControl,
  companionDevicePort: number,
  companionHostPort: number,
  reopenConversation: () => Promise<void>,
): Promise<void> {
  await clickAccessibility(driver, "New thread");
  await waitForVisibleTextContaining(driver, "What would you like to work on?");
  await captureNewThreadFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    control,
    driver,
    generation,
    layout: "phone",
    nonce,
    reopenNewThread: async () => {
      await driver.back();
      await waitForAccessibility(driver, "New thread");
      await clickAccessibility(driver, "New thread");
      await waitForVisibleTextContaining(driver, "What would you like to work on?");
    },
    restoreConversation: reopenConversation,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await driver.back();
  await waitForAccessibility(driver, "New thread");
  await clickAccessibility(driver, "Settings");
  await waitForAccessibility(driver, "Close server settings");
  await scrollAccessibilityIntoView(driver, "Actions for CodeWide E2E");
  await captureSavedServerFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    disconnectTransport: () => removeReversePort(device, REPO_ROOT, companionDevicePort),
    driver,
    generation,
    layout: "phone",
    reconnectTransport: async () => {
      await reverseHostPort(device, REPO_ROOT, companionHostPort, companionDevicePort);
    },
    serverName: "CodeWide E2E",
    timeoutMs: UI_TIMEOUT_MS,
  });
  await clickAccessibility(driver, "Close server settings");
  await reopenConversation();
  await driver.back();
  await waitForAccessibility(driver, "New thread");
}

async function captureRequestDraftParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  appServer: AppServerClient,
  control: SurfaceFaultControl,
  generation: RequestDraftGeneration,
  layout: RequestDraftLayout,
  nonce: string,
  restoreConversation: () => Promise<void>,
): Promise<void> {
  const capture = (
    rowId: string,
    state: string,
    assertExactState: () => Promise<void>,
  ): Promise<void> => captureVisualParityRow(driver, generation, rowId, state, assertExactState);
  const openThread = async (threadId: string, title: string, marker: string): Promise<void> => {
    if (generation === "v1") {
      await reopenLegacyThreadContaining(driver, title, layout === "phone", title);
      return;
    }
    await openProjectedThreadContaining(driver, marker, threadId);
  };
  const input = {
    appServer,
    capture,
    control,
    device,
    driver,
    generation,
    layout,
    nonce,
    openThread,
    repoRoot: REPO_ROOT,
    restoreConversation,
    timeoutMs: UI_TIMEOUT_MS,
  };
  await captureDraftParity(input);
  await captureInputParity(input);
  await captureRequestParity(input);
  await capturePaginationParity(input);
  await captureDisabledComposerMenuParity(input);
}

async function captureLifecycleParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  reopenConversation: () => Promise<void>,
  expectedCompletedTurns: number,
  companionDevicePort: number,
  companionHostPort: number,
): Promise<void> {
  await driver.pressKeyCode(3);
  await delay(500);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
  await captureVisualParityRow(
    driver,
    generation,
    "BOOT-08",
    `${layout}-resume-after-backgrounding`,
    async () => {
      await waitForAccessibility(driver, "Message Codex");
    },
  );

  if (layout === "phone") {
    await clickAccessibility(driver, "Back to threads");
    await waitForAccessibility(driver, "New thread");
  }
  try {
    await captureServerStatusTransitionParity({
      capture: (rowId, state, assertion) =>
        captureVisualParityRow(driver, generation, rowId, state, assertion),
      driver,
      generation,
      layout,
      serverName: "CodeWide E2E",
      status: "Offline",
      timeoutMs: UI_TIMEOUT_MS,
      trigger: async () => setAndroidNetworkOffline(device, REPO_ROOT, true),
    });
  } finally {
    await setAndroidNetworkOffline(device, REPO_ROOT, false);
  }
  await restartAndroidConnectionService(device);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);

  if (layout === "phone") {
    await clickAccessibility(driver, "Back to threads");
    await waitForAccessibility(driver, "New thread");
  }
  try {
    await captureServerStatusTransitionParity({
      capture: (rowId, state, assertion) =>
        captureVisualParityRow(driver, generation, rowId, state, assertion),
      driver,
      generation,
      layout,
      serverName: "CodeWide E2E",
      status: "Connection error",
      timeoutMs: UI_TIMEOUT_MS,
      trigger: async () => {
        await removeReversePort(device, REPO_ROOT, companionDevicePort);
      },
    });
  } finally {
    await adb(device, REPO_ROOT, [
      "reverse",
      `tcp:${String(companionDevicePort)}`,
      `tcp:${String(companionHostPort)}`,
    ]);
  }
  await restartAndroidConnectionService(device);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);

  if (layout === "phone") {
    await clickAccessibility(driver, "Back to threads");
    await waitForAccessibility(driver, "New thread");
  }
  await captureServerStatusTransitionParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    driver,
    generation,
    layout,
    serverName: "CodeWide E2E",
    status: "Updating",
    timeoutMs: UI_TIMEOUT_MS,
    trigger: async () => reconnectAndroidConnectionServiceInPlace(device),
  });
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);

  await stopAndroidConnectionService(device);
  await waitForPageSourceText(driver, "connecting");
  if (layout === "phone") {
    await clickAccessibility(driver, "Back to threads");
    await waitForAccessibility(driver, "New thread");
  }
  await captureServerStatusParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    driver,
    generation,
    layout,
    serverName: "CodeWide E2E",
    status: "Connecting",
    timeoutMs: UI_TIMEOUT_MS,
  });
  if (layout === "phone") {
    await reopenConversation();
    await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
  }
  await captureVisualParityRow(
    driver,
    generation,
    "BOOT-04",
    `${layout}-retained-projection-while-connecting`,
    async () => {
      await waitForAccessibility(driver, "Message Codex");
      await waitForPageSourceText(driver, "connecting");
      if (expectedCompletedTurns > 0) {
        const source = await driver.getPageSource();
        if (occurrenceCount(source, 'text="Completed"') < expectedCompletedTurns) {
          throw new Error("Retained projection lost completed turns while reconnecting");
        }
      }
    },
  );
  await captureRetainedConversationParity({
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    driver,
    expectedCompletedTurns,
    generation,
    layout,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureVisualParityRow(
    driver,
    generation,
    "BOOT-05",
    `${layout}-reconnect-after-socket-loss`,
    async () => {
      await waitForPageSourceText(driver, "connecting");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "CHAT-03",
    `${layout}-conversation-reconnecting`,
    async () => {
      await Promise.all([
        waitForAccessibility(driver, "Message Codex"),
        waitForPageSourceText(driver, "connecting"),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INPUT-05",
    `${layout}-composer-disabled-while-connecting`,
    async () => {
      const composer = await waitForAccessibility(driver, "Message Codex");
      if (await composer.isEnabled()) {
        throw new Error("Composer remains enabled while the authoritative transport reconnects");
      }
    },
  );
  if (layout === "wide") {
    await captureVisualParityRow(
      driver,
      generation,
      "LIST-02",
      "wide-thread-list-header-connecting",
      async () => {
        await waitForPageSourceText(driver, "connecting");
        await waitForAccessibility(driver, "Search threads");
      },
    );
  }
  await restartAndroidConnectionService(device);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);

  await driver.terminateApp(PACKAGE_NAME);
  await stopAndroidConnectionService(device);
  await activateApplication(driver, PACKAGE_NAME);
  await waitForApplicationReady(driver);
  await reopenConversation();
  await waitForVisualParityProjectionReady(driver, expectedCompletedTurns);
  await captureVisualParityRow(
    driver,
    generation,
    "BOOT-07",
    `${layout}-process-death-restoration`,
    async () => {
      await waitForAccessibility(driver, "Message Codex");
    },
  );
}

async function waitForPageSourceText(driver: AppiumBrowser, expected: string): Promise<void> {
  const normalized = expected.toLocaleLowerCase();
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await driver.getPageSource()).toLocaleLowerCase().includes(normalized)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for page source text: ${expected}`);
}

async function assertBottomSheetWithinViewport(driver: AppiumBrowser): Promise<void> {
  const sheet = await driver.$('//*[@pane-title="Bottom Sheet"]');
  await sheet.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  const [height, width, x, y, viewport] = await Promise.all([
    sheet.getSize("height"),
    sheet.getSize("width"),
    sheet.getLocation("x"),
    sheet.getLocation("y"),
    driver.getWindowSize(),
  ]);
  if (x < 0 || y < 0 || x + width > viewport.width || y + height > viewport.height) {
    throw new Error(
      `Bottom sheet exceeds the Android viewport: sheet ${x},${y} ${width}x${height}; viewport ${viewport.width}x${viewport.height}`,
    );
  }
}

async function captureOverlayParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  states: VisualParityOverlayState[],
): Promise<void> {
  for (const { assertionText, label, rowId, state } of states) {
    await driver.hideKeyboard().catch(() => undefined);
    await clickAccessibility(driver, label);
    await delay(400);
    await driver.hideKeyboard().catch(() => undefined);
    await delay(150);
    await captureVisualParityState(driver, `${state}-${generation}`);
    await captureVisualParityRow(driver, generation, rowId, state, async () => {
      await waitForVisibleTextContaining(driver, assertionText);
    });
    await driver.back();
    await driver.hideKeyboard().catch(() => undefined);
    await delay(250);
  }
}

async function captureConversationShellParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  expectedCompletedTurns: number,
): Promise<void> {
  await captureVisualParityRow(
    driver,
    generation,
    "CHAT-04",
    `${layout}-conversation-live`,
    async () => {
      await waitForAccessibility(driver, "Message Codex");
      if (expectedCompletedTurns > 0) {
        const source = await driver.getPageSource();
        if (occurrenceCount(source, 'text="Completed"') < expectedCompletedTurns) {
          throw new Error("Conversation parity capture is not in its settled live state");
        }
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    layout === "wide" ? "HEADER-01" : "HEADER-02",
    `${layout}-conversation-header`,
    async () => {
      const back = await driver.$("~Back to threads");
      const displayed = await back.isDisplayed().catch(() => false);
      if ((layout === "phone") !== displayed) {
        throw new Error(`Conversation ${layout} header has the wrong Back action visibility`);
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INPUT-01",
    `${layout}-composer-empty`,
    async () => {
      const composer = await waitForAccessibility(driver, "Message Codex");
      const value = await composer.getText();
      if (value !== "") throw new Error(`Parity composer should be empty, received ${value}`);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INT-04",
    `${layout}-disabled-empty-send-control`,
    async () => {
      const send = await driver.$("~Send message");
      await send.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      if (await send.isEnabled()) {
        throw new Error("Empty composer send action is unexpectedly enabled");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "VOICE-01",
    `${layout}-microphone-idle`,
    async () => {
      const idle = await waitForRightmostAccessibility(driver, "Voice input");
      const recording = await driver.$("~Stop voice input and insert transcript");
      if (!(await idle.isDisplayed()) || (await recording.isDisplayed().catch(() => false))) {
        throw new Error("Parity microphone is not in its idle state");
      }
    },
  );
  await captureNativeVoiceParityRows(driver, generation, layout);
  await captureSettledConversationParityRows(driver, generation, layout, expectedCompletedTurns);
  if (layout === "wide") {
    await captureVisualParityRow(
      driver,
      generation,
      "RESP-03",
      "wide-three-panel-layout",
      async () => {
        const viewport = await driver.getWindowSize();
        if (viewport.width <= viewport.height) {
          throw new Error(`Wide parity viewport is not wide: ${viewport.width}x${viewport.height}`);
        }
        await Promise.all([
          waitForAccessibility(driver, "New thread"),
          waitForAccessibility(driver, "Search threads"),
          waitForAccessibility(driver, "Message Codex"),
        ]);
      },
    );
  }
}

async function captureNativeVoiceParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await captureTransientVisualParityRow(
    driver,
    generation,
    "VOICE-02",
    `${layout}-voice-starting-policy`,
    async () => clickRightmostAccessibility(driver, "Voice input"),
    (source) => assertVoiceProgressSource(source, generation, "Connecting…"),
  );

  const recordingSource = await waitForVoiceSource(driver, (source) => {
    assertVoiceRecordingSource(source);
  });
  await captureVisualParityRow(
    driver,
    generation,
    "VOICE-03",
    `${layout}-voice-recording`,
    async () => {
      assertVoiceRecordingSource(recordingSource);
      assertVoiceRecordingSource(await driver.getPageSource());
    },
  );

  await captureTransientVisualParityRow(
    driver,
    generation,
    "VOICE-04",
    `${layout}-voice-finishing-policy`,
    async () => clickAccessibility(driver, "Stop voice input and insert transcript"),
    (source) => assertVoiceProgressSource(source, generation, "Transcribing…"),
  );

  await waitForAccessibility(driver, "Message Codex");
  const recording = await driver.$("~Voice recording");
  await recording.waitForDisplayed({ interval: 250, reverse: true, timeout: UI_TIMEOUT_MS });
  const idle = await waitForRightmostAccessibility(driver, "Voice input");
  if (!(await idle.isEnabled())) {
    throw new Error(
      `${generation.toUpperCase()} ${layout} voice session returned to a disabled idle microphone`,
    );
  }
}

async function captureTransientVisualParityRow(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  rowId: string,
  state: string,
  enterState: () => Promise<void>,
  assertSource: (source: string) => void,
): Promise<void> {
  await enterState();
  const key = `${rowId}-${state}`;
  const prefix = `${rowId.toLowerCase()}-${state}-${generation}`;
  const screenshot = `${prefix}.png`;
  const xml = `${prefix}.xml`;
  await waitForVoiceSource(driver, assertSource);
  await driver.saveScreenshot(path.join(parityArtifactDir, screenshot));
  const source = await driver.getPageSource();
  assertSource(source);
  await writeFile(path.join(parityArtifactDir, xml), source, { mode: 0o600 });
  const current = visualParityCaptures.get(key) ?? { rowId, state };
  current[generation] = { screenshot, xml };
  visualParityCaptures.set(key, current);
}

async function waitForVoiceSource(
  driver: AppiumBrowser,
  assertSource: (source: string) => void,
): Promise<string> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  let lastFailure: unknown = null;
  while (Date.now() < deadline) {
    const source = await driver.getPageSource();
    try {
      assertSource(source);
      return source;
    } catch (cause) {
      lastFailure = cause;
      await delay(100);
    }
  }
  const detail = lastFailure instanceof Error ? `: ${lastFailure.message}` : "";
  throw new Error(`Real native microphone did not reach the required Voice state${detail}`);
}

function assertVoiceProgressSource(
  source: string,
  generation: VisualGeneration,
  progressText: "Connecting…" | "Transcribing…",
): void {
  if (
    !source.includes('content-desc="Voice recording"') ||
    !source.includes(`text="${progressText}"`)
  ) {
    throw new Error(
      `${generation.toUpperCase()} Voice ${progressText} capture lacks its exact recording wrapper or progress text`,
    );
  }
  const hasProgressBar = source.includes('class="android.widget.ProgressBar"');
  if (generation === "v1" && !hasProgressBar) {
    throw new Error(`Frozen V1 Voice ${progressText} capture lacks its activity ProgressBar`);
  }
  if (generation === "v2" && hasProgressBar) {
    throw new Error(`V2 Voice ${progressText} capture still contains an activity ProgressBar`);
  }
}

function assertVoiceRecordingSource(source: string): void {
  if (
    !source.includes('content-desc="Voice recording"') ||
    !source.includes('content-desc="Stop voice input and insert transcript"') ||
    !/text="[0-9]+:[0-9]{2}"/u.test(source) ||
    source.includes('text="Connecting…"') ||
    source.includes('text="Transcribing…"')
  ) {
    throw new Error("Real native microphone did not expose the exact recording state");
  }
}

async function captureSettledConversationParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  expectedCompletedTurns: number,
): Promise<void> {
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-03",
    `${layout}-header-title-and-subtitle`,
    async () => {
      await Promise.all([
        waitForAccessibility(driver, "Search in thread"),
        waitForAccessibility(driver, "Context usage and account limits"),
        waitForAccessibility(driver, "Thread menu"),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-05",
    `${layout}-header-search-default`,
    async () => {
      const search = await waitForAccessibility(driver, "Search in thread");
      if (!(await search.isEnabled())) throw new Error("Conversation search action is disabled");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-07",
    `${layout}-header-context-ring`,
    async () => {
      const context = await waitForAccessibility(driver, "Context usage and account limits");
      if (!(await context.isEnabled())) throw new Error("Conversation context action is disabled");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-09",
    `${layout}-thread-menu-closed`,
    async () => {
      await waitForAccessibility(driver, "Thread menu");
      const pin = await driver.$('android=new UiSelector().textContains("Pin thread")');
      if (await pin.isDisplayed().catch(() => false)) {
        throw new Error("Thread menu is open during its closed-state capture");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    layout === "phone" ? "MSG-03" : "MSG-04",
    `${layout}-message-wrapping`,
    async () => {
      const viewport = await driver.getWindowSize();
      if ((layout === "phone") !== viewport.width < viewport.height) {
        throw new Error(`Message wrapping capture has the wrong ${layout} viewport`);
      }
      await waitForAccessibility(driver, "Message actions");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "MSG-11",
    `${layout}-message-action-rail-default`,
    async () => {
      await waitForAccessibility(driver, "Message actions");
    },
  );
  if (expectedCompletedTurns > 0) {
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-01",
      `${layout}-user-text-bubble`,
      async () => {
        const source = await driver.getPageSource();
        if (!source.includes("PARITYTURN")) {
          throw new Error("Settled parity thread has no visible user text bubble");
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-02",
      `${layout}-assistant-markdown-bubble`,
      async () => {
        const source = await driver.getPageSource();
        if (!/PARITY(?:ONE|TWO|THREE|ATTACH)/u.test(source)) {
          throw new Error("Settled parity thread has no visible assistant Markdown bubble");
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-05",
      `${layout}-markdown-heading-list-quote`,
      async () => {
        for (const text of ["Parity heading", "Parity list item", "Parity quote"]) {
          await waitForVisibleTextContaining(driver, text);
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-06",
      `${layout}-markdown-table`,
      async () => {
        for (const text of ["Parity column", "Parity cell", "42"]) {
          await waitForVisibleTextContaining(driver, text);
        }
      },
    );
    await captureVisualParityRow(driver, generation, "MSG-07", `${layout}-code-block`, async () => {
      await waitForVisibleTextContaining(driver, "PARITY_CODE_BLOCK");
    });
    const copyCode = await driver.$('android=new UiSelector().description("Copy text code block")');
    await copyCode.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    await copyCode.click();
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-08",
      `${layout}-full-width-copied-text-snippet`,
      async () => {
        await waitForVisibleTextContaining(driver, "Copied");
        await waitForVisibleTextContaining(driver, "PARITY_CODE_BLOCK");
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-10",
      `${layout}-markdown-link`,
      async () => {
        await waitForVisibleTextContaining(driver, "Parity link");
      },
    );
    const activity = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Expand activity ").descriptionContains("Edited files").descriptionContains("ran commands")',
    );
    await captureVisualParityRow(
      driver,
      generation,
      "LIFE-04",
      `${layout}-tool-activity-collapsed`,
      async () => {
        await activity.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    await activity.click();
    await captureVisualParityRow(
      driver,
      generation,
      "LIFE-05",
      `${layout}-tool-activity-expanded`,
      async () => {
        const expanded = await driver.$(
          'android=new UiSelector().descriptionStartsWith("Collapse activity ")',
        );
        await expanded.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    const command = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Expand ").descriptionContains("pwd")',
    );
    await command.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    await command.click();
    await captureVisualParityRow(
      driver,
      generation,
      "LIFE-07",
      `${layout}-command-activity-completed`,
      async () => {
        await Promise.all([
          waitForVisibleTextContaining(driver, "/bin/pwd"),
          waitForAccessibility(driver, "Status completed"),
        ]);
      },
    );
    const fileChange = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Expand File changes")',
    );
    await fileChange.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    await fileChange.click();
    await captureVisualParityRow(
      driver,
      generation,
      "LIFE-10",
      `${layout}-file-change-activity`,
      async () => {
        await waitForVisibleTextContaining(driver, "visual-parity-");
      },
    );
    const expandedActivity = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Collapse activity ")',
    );
    await expandedActivity.click();
    await clickLastAccessibility(driver, "Message actions");
    await captureVisualParityRow(
      driver,
      generation,
      "MSG-12",
      `${layout}-message-action-rail-open`,
      async () => {
        await waitForVisibleTextContaining(driver, "Copy");
      },
    );
    await driver.back();
    await waitForAccessibility(driver, "Message Codex");
    await captureVisualParityRow(
      driver,
      generation,
      "TURN-03",
      `${layout}-completed-turn-footer`,
      async () => {
        const source = await driver.getPageSource();
        if (occurrenceCount(source, 'text="Completed"') < expectedCompletedTurns) {
          throw new Error("Completed turn footer is absent from the settled parity thread");
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "TURN-04",
      `${layout}-completed-turn-token-usage`,
      async () => {
        const usage = await driver.$(
          'android=new UiSelector().descriptionContains(" input tokens, ")',
        );
        await usage.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    const cost = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Estimated API-equivalent cost ")',
    );
    await captureVisualParityRow(
      driver,
      generation,
      "TURN-05",
      `${layout}-completed-turn-cost-trigger`,
      async () => {
        await cost.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      },
    );
    await cost.click();
    await captureVisualParityRow(
      driver,
      generation,
      "TURN-06",
      `${layout}-turn-cost-breakdown`,
      async () => {
        await waitForVisibleTextContaining(
          driver,
          generation === "v1" ? "Cost breakdown" : "Usage breakdown",
        );
      },
    );
    await driver.back();
    await waitForAccessibility(driver, "Message Codex");
  }
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-01",
    `${layout}-model-thinking-chip`,
    async () => {
      const model = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
      );
      await model.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-03",
    `${layout}-permissions-chip`,
    async () => {
      const permissions = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: ")',
      );
      await permissions.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await captureVisualParityRow(driver, generation, "CTX-08", `${layout}-ports-chip`, async () => {
    const ports = await driver.$('android=new UiSelector().descriptionStartsWith("Ports: ")');
    await ports.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  });
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-11",
    `${layout}-context-strip-layout`,
    async () => {
      const [model, permissions, ports] = await Promise.all([
        driver.$('android=new UiSelector().descriptionStartsWith("Model and thinking: ")'),
        driver.$('android=new UiSelector().descriptionStartsWith("Permissions: ")'),
        driver.$('android=new UiSelector().descriptionStartsWith("Ports: ")'),
      ]);
      const displayed = await Promise.all([
        model.isDisplayed(),
        permissions.isDisplayed(),
        ports.isDisplayed(),
      ]);
      if (displayed.some((value) => !value)) {
        throw new Error("Composer context strip is missing one of its required visible chips");
      }
    },
  );
}

async function captureConversationControlParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await driver.hideKeyboard().catch(() => undefined);
  await clickAccessibility(driver, "Thread menu");
  await delay(300);
  await captureVisualParityState(driver, `${layout}-thread-menu-${generation}`);
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-10",
    `${layout}-thread-menu-open`,
    async () => {
      await waitForVisibleTextContaining(driver, "Pin thread");
    },
  );
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");

  await clickAccessibility(driver, "Search in thread");
  await waitForAccessibility(driver, "Search current thread");
  await captureVisualParityState(driver, `${layout}-conversation-search-${generation}`);
  await captureVisualParityRow(
    driver,
    generation,
    "HEADER-06",
    `${layout}-header-search-active`,
    async () => {
      await Promise.all([
        waitForAccessibility(driver, "Search current thread"),
        waitForAccessibility(driver, "Close thread search"),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "SEARCH-01",
    `${layout}-conversation-search-empty`,
    async () => {
      const input = await waitForAccessibility(driver, "Search current thread");
      const value = await input.getText();
      if (value !== "")
        throw new Error(`Conversation parity search should be empty, received ${value}`);
    },
  );
  await captureConversationSearchParityRows(driver, generation, layout);
  await clickAccessibility(driver, "Close thread search");
  await waitForAccessibility(driver, "Message Codex");

  const draft = "Visual parity draft";
  const composer = await waitForAccessibility(driver, "Message Codex");
  const keyboardWasInitiallyShown = await driver.isKeyboardShown();
  if (keyboardWasInitiallyShown) {
    throw new Error("Parity composer unexpectedly started with the Android IME visible");
  }
  await composer.click();
  await composer.setValue(draft);
  if (!(await driver.isKeyboardShown())) {
    throw new Error(`${generation.toUpperCase()} parity composer did not retain the Android IME`);
  }
  await captureVisualParityState(driver, `${layout}-composer-one-line-${generation}`);
  await captureVisualParityRow(
    driver,
    generation,
    "INPUT-02",
    `${layout}-composer-one-line`,
    async () => {
      const value = await composer.getText();
      if (value !== draft)
        throw new Error(`Parity composer lost its exact one-line draft: ${value}`);
    },
  );
  if (layout === "phone") {
    await captureVisualParityRow(
      driver,
      generation,
      "INPUT-04",
      "phone-composer-focused-with-keyboard",
      async () => {
        if (!(await driver.isKeyboardShown())) {
          throw new Error("Phone parity composer is not focused with the Android IME visible");
        }
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "RESP-08",
      "phone-keyboard-open-resize",
      async () => {
        if (!(await driver.isKeyboardShown())) {
          throw new Error("Keyboard closed-to-open parity state did not keep the IME visible");
        }
        await waitForAccessibility(driver, "Message Codex");
      },
    );
    await captureVisualParityRow(
      driver,
      generation,
      "INT-06",
      "phone-composer-focused-control",
      async () => {
        if (!(await driver.isKeyboardShown())) {
          throw new Error("Focused composer parity state has no Android IME");
        }
      },
    );
  }
  const multilineDraft = "Visual parity line one\nVisual parity line two\nVisual parity line three";
  await composer.setValue(multilineDraft);
  await captureVisualParityRow(
    driver,
    generation,
    "INPUT-03",
    `${layout}-composer-multiline`,
    async () => {
      if ((await composer.getText()) !== multilineDraft) {
        throw new Error("Parity composer did not retain its exact multiline draft");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "INPUT-06",
    `${layout}-send-enabled`,
    async () => {
      const send = await driver.$("~Send message");
      if (!(await send.isEnabled())) throw new Error("Parity composer send action is not enabled");
    },
  );
  await composer.clearValue();
  await driver.hideKeyboard().catch(() => undefined);
  await waitForAccessibility(driver, "Message Codex");
  if (layout === "wide") await capturePinnedSectionParityRow(driver, generation);
  if (layout === "phone") {
    await captureVisualParityRow(
      driver,
      generation,
      "RESP-09",
      "phone-keyboard-closed-resize",
      async () => {
        if (await driver.isKeyboardShown()) {
          throw new Error("Keyboard open-to-closed parity state still exposes the Android IME");
        }
        await waitForAccessibility(driver, "Message Codex");
      },
    );
  }
}

async function capturePinnedSectionParityRow(
  driver: AppiumBrowser,
  generation: VisualGeneration,
): Promise<void> {
  await clickAccessibility(driver, "Thread menu");
  await clickVisibleText(driver, "Pin thread");
  await captureVisualParityRow(driver, generation, "LIST-16", "wide-pinned-section", async () => {
    await waitForVisibleTextContaining(driver, "Pinned");
    await clickAccessibility(driver, "Thread menu");
    await waitForVisibleTextContaining(driver, "Unpin thread");
    await driver.back();
  });
  await clickAccessibility(driver, "Thread menu");
  await clickVisibleText(driver, "Unpin thread");
  await waitForAccessibility(driver, "Message Codex");
}

async function captureConversationSearchParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  const input = await waitForAccessibility(driver, "Search current thread");
  await input.setValue("PARITY");
  await delay(350);
  await captureVisualParityRow(
    driver,
    generation,
    "SEARCH-02",
    `${layout}-conversation-search-matches`,
    async () => {
      if ((await input.getText()) !== "PARITY") {
        throw new Error("Conversation search did not retain its matching query");
      }
      const source = await driver.getPageSource();
      if (!source.includes('text="PARITY')) {
        throw new Error("Conversation search did not render a matching parity message");
      }
    },
  );
  if (layout === "wide") {
    const previousLabel = await firstDisplayedAccessibilityLabel(driver, [
      "Previous match",
      "Previous thread match",
    ]);
    const previous = await waitForAccessibility(driver, previousLabel);
    await captureVisualParityRow(
      driver,
      generation,
      "SEARCH-04",
      "wide-conversation-search-previous",
      async () => {
        if (!(await previous.isEnabled())) {
          throw new Error("Previous conversation-search result is disabled with multiple matches");
        }
      },
    );
    await previous.click();
    const nextLabel = await firstDisplayedAccessibilityLabel(driver, [
      "Next match",
      "Next thread match",
    ]);
    const next = await waitForAccessibility(driver, nextLabel);
    await captureVisualParityRow(
      driver,
      generation,
      "SEARCH-05",
      "wide-conversation-search-next",
      async () => {
        if (!(await next.isEnabled())) {
          throw new Error("Next conversation-search result is disabled after moving backward");
        }
      },
    );
    await next.click();
  }
  await input.setValue(`NO_MATCH_${generation.toUpperCase()}`);
  await delay(350);
  await captureVisualParityRow(
    driver,
    generation,
    "SEARCH-03",
    `${layout}-conversation-search-no-matches`,
    async () => {
      const source = await driver.getPageSource();
      if (!source.includes('text="0"')) {
        throw new Error("Conversation search did not report zero matches");
      }
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "SEARCH-06",
    `${layout}-conversation-search-close`,
    async () => {
      await waitForAccessibility(driver, "Close thread search");
    },
  );
}

async function firstDisplayedAccessibilityLabel(
  driver: AppiumBrowser,
  labels: readonly string[],
): Promise<string> {
  for (const label of labels) {
    const element = await driver.$(`~${label}`);
    if (await element.isDisplayed().catch(() => false)) return label;
  }
  throw new Error(`None of the expected accessibility labels is displayed: ${labels.join(", ")}`);
}

async function captureNewThreadParityStates(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  nonce: string,
  control: SurfaceFaultControl,
  reopenConversation: () => Promise<void>,
): Promise<void> {
  await clickAccessibility(driver, "New thread");
  await waitForVisibleTextContaining(driver, "What would you like to work on?");
  await captureVisualParityRow(
    driver,
    generation,
    "EMPTY-02",
    `${layout}-new-thread-project-prompt`,
    async () => {
      await waitForVisibleTextContaining(driver, "What would you like to work on?");
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "NEW-01",
    `${layout}-new-thread-project-selector`,
    async () => {
      const project = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Change project, currently ")',
      );
      await project.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "EMPTY-03",
    `${layout}-new-thread-workspace-prompt`,
    async () => {
      const workspace = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Workspace mode, ")',
      );
      await Promise.all([
        waitForVisibleTextContaining(driver, "What would you like to work on?"),
        workspace.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 }),
      ]);
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "NEW-02",
    `${layout}-new-thread-workspace-mode`,
    async () => {
      const workspace = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Workspace mode, ")',
      );
      await workspace.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "NEW-03",
    `${layout}-new-thread-model-thinking-permissions`,
    async () => {
      const model = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
      );
      const permissions = await driver.$(
        'android=new UiSelector().descriptionStartsWith("Permissions: ")',
      );
      await Promise.all([
        model.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 }),
        permissions.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 }),
      ]);
    },
  );
  await captureNewThreadFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    control,
    driver,
    generation,
    layout,
    nonce,
    reopenNewThread: async () => {
      await clickAccessibility(driver, "New thread");
      await waitForVisibleTextContaining(driver, "What would you like to work on?");
    },
    restoreConversation: reopenConversation,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await waitForAccessibility(driver, "Message Codex");
}

async function captureEmptyContextChipParityRows(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
): Promise<void> {
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-04",
    `${layout}-empty-changes-chip-policy`,
    async () => {
      await assertIntentionalEmptyContextChipState(driver, generation, {
        empty: "No changes",
        loading: "Loading changes",
        populated: "Changes ·",
      });
    },
  );
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-06",
    `${layout}-empty-attachments-chip-policy`,
    async () => {
      await assertIntentionalEmptyContextChipState(driver, generation, {
        empty: "No attachments",
        loading: "Loading attachments",
        populated: "Attachments ·",
      });
    },
  );
}

async function assertIntentionalEmptyContextChipState(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  labels: { empty: string; loading: string; populated: string },
): Promise<void> {
  if (generation === "v2") {
    await assertContextChipAbsent(driver, [labels.empty, labels.loading, labels.populated]);
    return;
  }
  const emptyChip = await driver.$(
    `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(labels.empty)}")`,
  );
  await emptyChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await assertContextChipAbsent(driver, [labels.loading, labels.populated]);
}

async function assertContextChipAbsent(
  driver: AppiumBrowser,
  accessibilityPrefixes: readonly string[],
): Promise<void> {
  for (let sample = 0; sample < 3; sample += 1) {
    for (const prefix of accessibilityPrefixes) {
      const chip = await driver.$(
        `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(prefix)}")`,
      );
      if (await chip.isDisplayed().catch(() => false)) {
        throw new Error(`Empty context chip must be absent, but ${prefix} is displayed`);
      }
    }
    if (sample < 2) await delay(250);
  }
}

async function captureSettingsParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  companionDevicePort: number,
  companionHostPort: number,
  reopenConversation: () => Promise<void>,
): Promise<void> {
  if (layout === "phone") {
    await returnToThreadListSurface(driver);
    const settings = await driver.$("~Settings");
    if (!(await settings.isDisplayed().catch(() => false))) {
      await clickAccessibility(driver, "Choose server");
    }
  }
  await clickAccessibility(driver, "Settings");
  await waitForAccessibility(driver, "Close server settings");
  await captureVisualParityRow(driver, generation, "SET-01", `${layout}-settings-root`, async () => {
    await waitForVisibleTextContaining(driver, "Settings");
    await scrollAccessibilityIntoView(driver, "Actions for CodeWide E2E");
  });
  await captureSavedServerFailureParity({
    capture: (rowId, state, assertion) =>
      captureVisualParityRow(driver, generation, rowId, state, assertion),
    disconnectTransport: () => removeReversePort(device, REPO_ROOT, companionDevicePort),
    driver,
    generation,
    layout,
    reconnectTransport: async () => {
      await reverseHostPort(device, REPO_ROOT, companionHostPort, companionDevicePort);
    },
    serverName: "CodeWide E2E",
    timeoutMs: UI_TIMEOUT_MS,
  });
  if (generation === "v1") {
    await captureVisualParityRow(
      driver,
      generation,
      "SET-07",
      `${layout}-account-settings`,
      async () => {
        await waitForVisibleTextContaining(driver, "Codex accounts");
      },
    );
  }
  await clickLastAccessibility(driver, "Actions for CodeWide E2E");
  if (generation === "v1") {
    await driver.back();
    await captureVisualParityRow(
      driver,
      generation,
      "SET-02",
      `${layout}-saved-server-live`,
      async () => {
        await Promise.all([
          waitForVisibleTextContaining(driver, "CodeWide E2E"),
          waitForVisibleTextContaining(driver, "TLS pinned"),
        ]);
      },
    );
  } else {
    await clickVisibleText(driver, "Edit server");
    await waitForVisibleTextContaining(driver, "Server settings");
    await captureVisualParityRow(
      driver,
      generation,
      "SET-02",
      `${layout}-saved-server-live`,
      async () => {
        await waitForAccessibility(driver, "Actions for CodeWide E2E");
      },
    );
    await clickAccessibility(driver, "Actions for CodeWide E2E");
    await clickVisibleText(driver, "Accounts");
    await captureVisualParityRow(
      driver,
      generation,
      "SET-07",
      `${layout}-account-settings`,
      async () => {
        await Promise.all([
          waitForVisibleTextContaining(driver, "Codex accounts"),
          waitForAccessibility(driver, "Close Codex accounts"),
        ]);
      },
    );
    await driver.back();
    await waitForVisibleTextContaining(driver, "Server settings");
  }
  await clickAccessibility(driver, "Actions for CodeWide E2E");
  await clickVisibleText(driver, "Delete server");
  await waitForAccessibility(driver, "Confirm delete server");
  await captureVisualParityRow(
    driver,
    generation,
    "SET-05",
    `${layout}-saved-server-delete-confirmation`,
    async () => {
      await waitForAccessibility(driver, "Confirm delete server");
    },
  );
  await driver.back();
  if (generation === "v2") {
    await waitForVisibleTextContaining(driver, "Server settings");
    await driver.back();
  }
  await waitForAccessibility(driver, "Close server settings");
  await clickAccessibility(driver, "Close server settings");
  await reopenConversation();
  await waitForAccessibility(driver, "Message Codex");
}

async function captureStaticResourceParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  resourceFixture: ResourceParityFixture,
): Promise<void> {
  const model = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Model and thinking: ")',
  );
  await model.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
  await model.click();
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-02",
    "wide-personality-chip-control",
    async () => {
      await Promise.all([
        waitForVisibleTextContaining(driver, "Thinking level"),
        waitForVisibleTextContaining(driver, "Personality"),
      ]);
    },
  );
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");

  const changes = await driver.$('android=new UiSelector().descriptionStartsWith("Changes ·")');
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-05",
    "wide-changes-chip-populated",
    async () => {
      await changes.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await changes.click();
  await waitForVisibleTextContaining(driver, "visual-parity-");
  await captureVisualParityRow(driver, generation, "CHG-04", "wide-changed-file-list", async () => {
    await waitForVisibleTextContaining(driver, "visual-parity-");
  });
  if (generation === "v1") {
    await clickAccessibility(driver, "Changes options");
  }
  await captureVisualParityRow(
    driver,
    generation,
    "CHG-03",
    "wide-changes-scope-selector",
    async () => {
      await Promise.all([
        waitForVisibleTextContaining(driver, "Session"),
        waitForVisibleTextContaining(driver, "Last turn"),
      ]);
    },
  );
  if (generation === "v1") await driver.back();
  await captureVisualParityRow(driver, generation, "CHG-05", "wide-file-diff", async () => {
    await waitForVisibleTextContaining(driver, "PARITY_CHANGE_CONTENT");
  });
  await captureVisualParityRow(driver, generation, "CHG-06", "wide-review-controls", async () => {
    await waitForAccessibility(driver, generation === "v1" ? "Attach review" : "Review");
  });
  await clickAccessibility(driver, generation === "v1" ? "Close code review" : "Close changes");
  await waitForAccessibility(driver, "Message Codex");

  const attachments = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Attachments ·")',
  );
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-07",
    "wide-attachments-chip-populated",
    async () => {
      await attachments.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );
  await attachments.click();
  await captureVisualParityRow(driver, generation, "ATT-03", "wide-attachments-list", async () => {
    await Promise.all([
      waitForVisibleTextContaining(driver, "Attachments"),
      waitForVisibleTextContaining(driver, "package.json"),
    ]);
  });
  await clickAccessibility(driver, "Open attachment package.json");
  await captureVisualParityRow(driver, generation, "ATT-05", "wide-document-preview", async () => {
    await Promise.all([
      waitForAccessibility(driver, generation === "v1" ? "Close attachments" : "Close attachment"),
      waitForVisibleTextContaining(driver, "package.json"),
    ]);
  });
  if (generation === "v2") await clickAccessibility(driver, "Close attachment");
  await clickAccessibility(driver, "Close attachments");
  await waitForAccessibility(driver, "Message Codex");

  await captureTerminalLoadingParity({
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    device,
    driver,
    fixture: resourceFixture,
    generation,
    layout: "wide",
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    timeoutMs: UI_TIMEOUT_MS,
  });

  let terminalChip = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Terminals: ")',
  );
  if (!(await terminalChip.isDisplayed().catch(() => false))) {
    await clickAccessibility(driver, "Composer menu");
    await clickVisibleText(driver, "Terminal");
    await ensureTerminalOpen(driver);
  } else {
    await terminalChip.click();
    await ensureTerminalOpen(driver);
  }
  await sendTerminalCommand(driver, "printf 'PARITY_TERMINAL\\n'");
  await captureVisualParityRow(driver, generation, "TERM-03", "wide-active-terminal", async () => {
    await Promise.all([
      waitForAccessibility(driver, "Terminal 1"),
      waitForVisibleTextContaining(driver, "PARITY_TERMINAL"),
    ]);
  });
  await clickAccessibility(driver, "Minimize terminal");
  await waitForAccessibility(driver, "Message Codex");
  terminalChip = await driver.$('android=new UiSelector().descriptionStartsWith("Terminals: ")');
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-09",
    "wide-terminals-chip-populated",
    async () => {
      await terminalChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    },
  );

  await clickAccessibilityContaining(driver, "Ports:");
  await waitForVisibleTextContaining(driver, "No active ports");
  await captureVisualParityRow(driver, generation, "PORT-02", "wide-ports-empty", async () => {
    await waitForVisibleTextContaining(driver, "No active ports");
  });
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");
  const resourceInput = {
    capture: (rowId: string, state: string, assertExactState: () => Promise<void>): Promise<void> =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    device,
    driver,
    fixture: resourceFixture,
    generation,
    layout: "wide" as const,
    packageName: PACKAGE_NAME,
    repoRoot: REPO_ROOT,
    timeoutMs: UI_TIMEOUT_MS,
  };
  await captureAttachmentResourceParity(resourceInput);
  await captureAttachmentAndChangesStateParity(resourceInput);
  await capturePortLoadingAndErrorParity(resourceInput);
  await captureDiscoveredPortParity(resourceInput);
  await captureBoundedTunnelPolicy(resourceInput);
  await captureTerminalLifecycleParity(resourceInput);
}

async function captureEmptyThreadParityState(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  threadId: string | null,
  title: string | null,
  reopenConversation: () => Promise<void>,
  layout: VisualParityLayout = "wide",
): Promise<void> {
  if (threadId === null || title === null) {
    throw new Error("Empty-thread parity fixture was not created");
  }
  if (generation === "v1") {
    await reopenLegacyThreadContaining(driver, title, false, title);
  } else {
    await openProjectedThreadContaining(driver, title, threadId);
  }
  await captureVisualParityRow(
    driver,
    generation,
    "EMPTY-01",
    `${layout}-existing-empty-thread`,
    async () => {
      await Promise.all([
        waitForAccessibility(driver, "Message Codex"),
        waitForVisibleTextContaining(driver, title),
      ]);
      const actions = await driver.$("~Message actions");
      if (await actions.isDisplayed().catch(() => false)) {
        throw new Error("Empty-thread parity fixture unexpectedly contains a rendered turn");
      }
    },
  );
  await captureEmptyContextChipParityRows(driver, generation, layout);
  await captureEmptyAttachmentPolicy({
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    driver,
    generation,
    layout,
    timeoutMs: UI_TIMEOUT_MS,
  });
  await captureVisualParityRow(
    driver,
    generation,
    "AGENT-01",
    `${layout}-zero-agent-chip-absent`,
    async () => {
      const chip = await driver.$('android=new UiSelector().descriptionStartsWith("Subagents: ")');
      if (await chip.isDisplayed().catch(() => false)) {
        throw new Error("Zero-agent thread unexpectedly exposes a Subagents chip");
      }
    },
  );
  await clickAccessibility(driver, "Composer menu");
  await captureVisualParityRow(
    driver,
    generation,
    "AGENT-02",
    `${layout}-zero-agent-menu-action-absent`,
    async () => {
      await waitForVisibleTextContaining(driver, "Skills");
      const source = await driver.getPageSource();
      if (/\b(?:text|content-desc)="(?:Agents|Subagents)"/u.test(source)) {
        throw new Error("Zero-agent composer menu unexpectedly exposes an Agents action");
      }
    },
  );
  await driver.back();
  await waitForAccessibility(driver, "Message Codex");
  await reopenConversation();
  await waitForAccessibility(driver, "Message Codex");
}

function requireParityAgentFixture(fixture: ParityAgentFixture | null): ParityAgentFixture {
  if (fixture === null) throw new Error("Real subagent parity fixture was not created");
  return fixture;
}

function requireThreadRowParityFixture(
  fixture: ThreadRowParityFixture | null,
): ThreadRowParityFixture {
  if (fixture === null) throw new Error("Real thread-row parity fixture was not created");
  return fixture;
}

function requireConversationLifecycleFixture(
  fixture: ConversationLifecycleParityFixture | null,
): ConversationLifecycleParityFixture {
  if (fixture === null) throw new Error("Conversation lifecycle parity fixture was not created");
  return fixture;
}

function requireResourceParityFixture(
  fixture: ResourceParityFixture | null,
): ResourceParityFixture {
  if (fixture === null) throw new Error("Resource parity fixture was not created");
  return fixture;
}

async function captureThreadRowParityScenario(
  driver: AppiumBrowser,
  device: AndroidDevice,
  appServer: AppServerClient,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  fixture: ThreadRowParityFixture,
  faultControl: ThreadRowParityFaultControl,
): Promise<void> {
  await captureThreadRowParityStates({
    appServer,
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    disconnect: () => stopAndroidConnectionService(device),
    driver,
    fixture,
    faultControl,
    generation,
    layout,
    reconnect: async () => {
      await restartAndroidConnectionService(device);
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
      const composer = await driver.$("~Message Codex");
      if (layout === "phone" && (await composer.isDisplayed().catch(() => false))) {
        await driver.back();
      }
      await waitForAccessibility(driver, "New thread");
      await waitForConnectionReady(driver);
    },
    resetCatalog: async () => {
      const previousProcessId = await androidProcessId(device);
      if (previousProcessId === "") {
        throw new Error("Catalog reset could not observe the running Android application process");
      }
      await driver.terminateApp(PACKAGE_NAME);
      await waitForAndroidProcessExit(device, previousProcessId);
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
      const nextProcessId = await androidProcessId(device);
      if (nextProcessId === "" || nextProcessId === previousProcessId) {
        throw new Error("Catalog reset did not cold-start a new Android application process");
      }
      const composer = await driver.$("~Message Codex");
      if (layout === "phone" && (await composer.isDisplayed().catch(() => false))) {
        await driver.back();
      }
      await waitForAccessibility(driver, "New thread");
      await waitForConnectionReady(driver);
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
}

async function androidProcessId(device: AndroidDevice): Promise<string> {
  return adb(device, REPO_ROOT, ["shell", "pidof", PACKAGE_NAME], {
    allowFailure: true,
  }).then((value) => value.trim());
}

async function waitForAndroidProcessExit(
  device: AndroidDevice,
  previousProcessId: string,
): Promise<void> {
  const deadline = Date.now() + UI_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentProcessId = await androidProcessId(device);
    if (currentProcessId === "" || currentProcessId !== previousProcessId) return;
    await delay(100);
  }
  throw new Error(`Android process ${previousProcessId} did not exit during catalog reset`);
}

async function captureConversationLifecycleParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  appServer: AppServerClient,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  fixture: ConversationLifecycleParityFixture,
  rowFixture: ThreadRowParityFixture,
  control: SurfaceFaultControl,
): Promise<void> {
  const returnToThreadList = async (): Promise<void> => {
    await returnToThreadListSurface(driver);
    await waitForAccessibility(driver, "New thread");
  };
  const beginOpenThread = async (thread: ConversationLifecycleThread): Promise<void> => {
    await returnToThreadList();
    const search = await waitForAccessibility(driver, "Search threads");
    await search.clearValue();
    await search.addValue(thread.title);
    const prefix = generation === "v1" ? thread.title : `Open thread ${thread.title}`;
    const row = await driver.$(
      `android=new UiSelector().descriptionStartsWith("${escapeUiSelector(prefix)}")`,
    );
    await row.waitForDisplayed({ interval: 250, timeout: UI_TIMEOUT_MS });
    await row.click();
  };
  const openThread = async (thread: ConversationLifecycleThread): Promise<void> => {
    if (layout === "phone") {
      const composer = await driver.$("~Message Codex");
      if (await composer.isDisplayed().catch(() => false)) {
        await clickAccessibility(driver, "Back to threads");
        await waitForAccessibility(driver, "New thread");
      }
    }
    if (generation === "v1") {
      await reopenLegacyThreadContaining(driver, thread.title, layout === "phone", thread.title);
      return;
    }
    await openProjectedThreadContaining(driver, thread.title, thread.id);
  };
  await captureConversationLifecycleParity({
    appServer,
    beginOpenThread,
    capture: (rowId, state, assertExactState) =>
      captureVisualParityRow(driver, generation, rowId, state, assertExactState),
    control,
    driver,
    fixture,
    generation,
    layout,
    openThread,
    reconnectCurrentThread: async () => {
      await reconnectAndroidConnectionServiceInPlace(device);
      await activateApplication(driver, PACKAGE_NAME);
      await waitForApplicationReady(driver);
    },
    returnToThreadList,
    rowFixture,
    showAttachment: async (name) => {
      await scrollAccessibilityIntoView(driver, `Open ${name}`);
    },
    submitQueuedMessage: async (message) => {
      await sendComposerMessage(driver, message, { requireKeyboard: true });
      if (await driver.isKeyboardShown()) await driver.hideKeyboard();
    },
    timeoutMs: UI_TIMEOUT_MS,
  });
}

async function captureAgentParityStates(
  driver: AppiumBrowser,
  device: AndroidDevice,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  fixture: ParityAgentFixture,
  companionHostPort: number,
  reopenConversation: () => Promise<void>,
): Promise<void> {
  await openAgentFixtureThread(driver, generation, layout, fixture);
  const chip = await driver.$('android=new UiSelector().descriptionStartsWith("Subagents: ")');
  await captureVisualParityRow(
    driver,
    generation,
    "CTX-10",
    `${layout}-subagents-chip-populated`,
    async () => {
      await chip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      const label = await chip.getAttribute("content-desc");
      if (typeof label !== "string" || !/Subagents: [1-9][0-9]*/u.test(label)) {
        throw new Error(`Subagents chip has no positive count: ${String(label)}`);
      }
    },
  );
  await chip.click();
  const agentRow = await driver.$(
    'android=new UiSelector().descriptionStartsWith("Open subagent ")',
  );
  await captureVisualParityRow(driver, generation, "AGENT-03", `${layout}-agent-list`, async () => {
    await Promise.all([
      waitForVisibleTextContaining(driver, "Subagents"),
      waitForVisibleTextContaining(driver, "newest activity first"),
      agentRow.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 }),
    ]);
  });
  await agentRow.click();
  await captureVisualParityRow(
    driver,
    generation,
    "AGENT-04",
    `${layout}-selected-child-conversation`,
    async () => {
      await waitForVisibleTextContaining(driver, fixture.childReply);
      if (layout === "wide") {
        const selected = await driver.$(
          'android=new UiSelector().descriptionStartsWith("Open subagent ").selected(true)',
        );
        await selected.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
      } else {
        await waitForAccessibility(driver, "Back to threads");
      }
    },
  );
  if (layout === "phone") {
    await clickAccessibility(driver, "Back to threads");
    await waitForAccessibility(driver, "Back to conversation");
  }
  await clickAccessibility(driver, "Back to conversation");
  await waitForAccessibility(driver, "Message Codex");

  await removeReversePort(device, REPO_ROOT, 18_765);
  try {
    await driver.terminateApp(PACKAGE_NAME);
    await stopAndroidConnectionService(device);
    await activateApplication(driver, PACKAGE_NAME);
    await waitForApplicationReady(driver);
    await openAgentFixtureThread(driver, generation, layout, fixture);
    const offlineChip = await driver.$(
      'android=new UiSelector().descriptionStartsWith("Subagents: ")',
    );
    await offlineChip.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
    await offlineChip.click();
    await captureVisualParityRow(
      driver,
      generation,
      "AGENT-05",
      `${layout}-agent-refresh-error-policy`,
      async () => {
        const retry = await driver.$("~Try again");
        const loading = await driver.$('android=new UiSelector().textContains("Loading agents")');
        if (generation === "v2") {
          await retry.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
          if (await loading.isDisplayed().catch(() => false)) {
            throw new Error("V2 agent failure remains in loading state instead of retryable error");
          }
          return;
        }
        const retainedRow = await driver.$(
          'android=new UiSelector().descriptionStartsWith("Open subagent ")',
        );
        await retainedRow.waitForDisplayed({ timeout: UI_TIMEOUT_MS, interval: 250 });
        if (!(await retainedRow.isEnabled())) {
          throw new Error("Frozen V1 did not retain an actionable cached agent row");
        }
        if (await retry.isDisplayed().catch(() => false)) {
          throw new Error("Frozen V1 unexpectedly exposed the V2 retry action");
        }
        if (await loading.isDisplayed().catch(() => false)) {
          throw new Error("Frozen V1 replaced the cached agent list with loading state");
        }
      },
    );
  } finally {
    await reverseHostPort(device, REPO_ROOT, companionHostPort, 18_765);
    await restartAndroidConnectionService(device);
    await activateApplication(driver, PACKAGE_NAME);
    await waitForApplicationReady(driver);
    await reopenConversation();
    await waitForAccessibility(driver, "Message Codex");
  }
}

async function openAgentFixtureThread(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  layout: VisualParityLayout,
  fixture: ParityAgentFixture,
): Promise<void> {
  if (generation === "v1") {
    await reopenLegacyThreadContaining(
      driver,
      fixture.parentTitle,
      layout === "phone",
      fixture.parentReply,
    );
  } else {
    await openProjectedThreadContaining(driver, fixture.parentReply, fixture.parentThreadId);
  }
  await waitForVisibleTextContaining(driver, fixture.parentReply);
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
  if (visualDiff.ratio > VISUAL_DIFF_MAX_RATIO) {
    visualParityMacroFailures.push(
      `Visual parity failed for ${state}: ${(visualDiff.ratio * 100).toFixed(2)}% differs, maximum ${(VISUAL_DIFF_MAX_RATIO * 100).toFixed(2)}%`,
    );
  }
}

async function captureVisualParityRow(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
  postureOverride?: AndroidE2eCapturePosture,
): Promise<void> {
  await assertExactState();
  const key = `${rowId}-${state}`;
  const prefix = `${rowId.toLowerCase()}-${state}-${generation}`;
  const screenshot = `${prefix}.png`;
  const xml = `${prefix}.xml`;
  const viewport = await driver.getWindowSize();
  const pageSource = await driver.getPageSource();
  await Promise.all([
    driver.saveScreenshot(path.join(parityArtifactDir, screenshot)),
    writeFile(path.join(parityArtifactDir, xml), pageSource, { mode: 0o600 }),
  ]);
  const current = visualParityCaptures.get(key) ?? { rowId, state };
  if (current[generation] !== undefined) {
    throw new Error(`Duplicate direct parity capture ${rowId}/${state}/${generation}`);
  }
  current[generation] = { screenshot, xml };
  visualParityCaptures.set(key, current);
  recordCaptureProvenance(
    driver,
    generation,
    rowId,
    state,
    screenshot,
    xml,
    viewport,
    postureOverride,
  );
  const interactionAliases = await collectInteractionInventoryAliases({
    driver,
    pageSource,
    sourceRowId: rowId,
    sourceState: state,
  });
  for (const alias of interactionAliases) {
    await captureVisualParityRow(
      driver,
      generation,
      alias.rowId,
      alias.state,
      alias.assertExactState,
    );
  }
  await capturePressedInteractionInventory({
    capture: (pressedRowId, pressedState, pressedAssertion) =>
      captureVisualParityRow(driver, generation, pressedRowId, pressedState, pressedAssertion),
    driver,
    pageSource,
    sourceRowId: rowId,
    sourceState: state,
  });
}

function recordCaptureProvenance(
  driver: AppiumBrowser,
  generation: VisualGeneration,
  rowId: string,
  state: string,
  screenshot: string,
  xml: string,
  viewport: { height: number; width: number },
  postureOverride?: AndroidE2eCapturePosture,
): void {
  if (TARGET_FAMILY === null) return;
  captureProvenance.push({
    captureId: randomUUID(),
    capturedAt: new Date().toISOString(),
    generation,
    origin: { kind: "appium", sessionId: driver.sessionId },
    posture: postureOverride ?? capturePosture(viewport),
    rowId,
    screenshot,
    state,
    targetFamily: TARGET_FAMILY,
    viewport,
    xml,
  });
}

function capturePosture(viewport: { height: number; width: number }): AndroidE2eCapturePosture {
  if (TARGET_FAMILY === "phone") {
    return viewport.width > viewport.height ? "phoneLandscape" : "phonePortrait";
  }
  return currentFoldPosture;
}

function parityBlocker(rowId: string): { code: string; evidence: string } {
  if (rowId === "CHG-05" || rowId === "CHG-06") {
    return {
      code: "v2-contract-unavailable",
      evidence:
        "The current V2 changes contract exposes the changed-file list but not file-diff or review actions; docs/android-v2-visual-parity.md records that contract gap.",
    };
  }
  if (/^BOOT-0[1-3]$/u.test(rowId)) {
    return {
      code: "pre-appium-transient",
      evidence:
        "The current Appium session launches and attaches after native bootstrap, so this pre-session transient has no paired capture point yet.",
    };
  }
  if (
    /^(?:BOOT-0[4-8]|LIST-0[2-5]|LIST-1[2-5]|ROW-0[2-6]|CHAT-0[1-3]|HEADER-04|LIFE-|TURN-0[1-2]|TURN-0[7-8]|REQ-|PAGE-|INPUT-0[5-9]|DRAFT-|QUEUE-|VOICE-0[2-8]|ATT-0[1489]|CHG-0[17]|TERM-0[126-9]|PORT-0[1578]|AGENT-0[15]|NEW-0[45]|PAIR-0[2456]|SET-0[346])/.test(
      rowId,
    )
  ) {
    return {
      code: "non-rewindable-live-state",
      evidence:
        "V1 and V2 are runtime-isolated and the managed real Observer state cannot be rewound; an exact-data transient pair needs synchronized clients or a deterministic backend fault/fixture not yet present in this harness.",
    };
  }
  return {
    code: "missing-dedicated-scenario",
    evidence: `No exact-state assertion and fresh paired capture is registered for ${rowId}; this row remains a release-visible harness gap.`,
  };
}

function intentionalVisualDifference(
  rowId: string,
):
  | { code: "v2-hide-empty-context-chip"; evidence: string }
  | { code: "v2-visible-agent-retry"; evidence: string }
  | { code: "v2-shimmer-catalog-pagination"; evidence: string }
  | { code: "v2-shimmer-history-pagination"; evidence: string }
  | { code: "v2-attachment-upload-progress"; evidence: string }
  | { code: "v2-retry-failed-queue-item"; evidence: string }
  | { code: "v2-visible-voice-cancellation"; evidence: string }
  | { code: "v2-shimmer-voice-starting"; evidence: string }
  | { code: "v2-shimmer-voice-finishing"; evidence: string }
  | { code: "v2-empty-attachments-state"; evidence: string }
  | { code: "v2-inline-video-player"; evidence: string }
  | { code: "v2-authoritative-waiting-input"; evidence: string }
  | { code: "v2-bounded-tunnel-active"; evidence: string }
  | { code: "v2-bounded-tunnel-create-pending"; evidence: string }
  | { code: "v2-bounded-tunnel-revoke-pending"; evidence: string }
  | { code: "v2-bounded-tunnel-expiry"; evidence: string }
  | { code: "v2-terminal-replay-recovery"; evidence: string }
  | { code: "v2-terminal-exit-lifecycle"; evidence: string }
  | { code: "v2-new-thread-create-progress"; evidence: string }
  | { code: "v2-new-thread-action-progress"; evidence: string }
  | null {
  if (rowId === "CTX-04" || rowId === "CTX-06") {
    return {
      code: "v2-hide-empty-context-chip",
      evidence:
        "Frozen V1 renders the empty context chip; the product rule requires V2 to omit it.",
    };
  }
  if (rowId === "AGENT-05") {
    return {
      code: "v2-visible-agent-retry",
      evidence:
        "Frozen V1 silently retains the cached agent list; the product rule requires V2 to expose a typed retryable error.",
    };
  }
  if (rowId === "LIST-21") {
    return {
      code: "v2-shimmer-catalog-pagination",
      evidence:
        "Frozen V1 reveals the next catalog page from local SQLite without progress; V2 fetches bounded catalog.page and must use ShimmerText while both expose the same run-bound result.",
    };
  }
  if (rowId === "PAGE-03") {
    return {
      code: "v2-shimmer-history-pagination",
      evidence:
        "Frozen V1 reveals the cached newer range from local SQLite without progress; V2 fetches bounded history.page and must use ShimmerText while both expose the same run-bound newer-turn result.",
    };
  }
  if (rowId === "DRAFT-01") {
    return {
      code: "v2-attachment-upload-progress",
      evidence:
        "Frozen V1 does not materialize a draft attachment until upload completes; V2 exposes the real pending attachment draft while both expose the same usable uploaded attachment after release.",
    };
  }
  if (rowId === "QUEUE-08") {
    return {
      code: "v2-retry-failed-queue-item",
      evidence:
        "Frozen V1 leaves a failed queued item without retry; the product rule requires V2 to expose Retry queued prompt.",
    };
  }
  if (rowId === "VOICE-07") {
    return {
      code: "v2-visible-voice-cancellation",
      evidence:
        "Frozen V1 returns to idle before cancellation completes; the product rule requires V2 to expose the pending cancellation state.",
    };
  }
  if (rowId === "VOICE-02") {
    return {
      code: "v2-shimmer-voice-starting",
      evidence:
        "Frozen V1 uses an activity spinner while voice capture starts; the product rule requires V2 to use ShimmerText without a spinner.",
    };
  }
  if (rowId === "VOICE-04") {
    return {
      code: "v2-shimmer-voice-finishing",
      evidence:
        "Frozen V1 uses an activity spinner while voice capture finishes; the product rule requires V2 to use ShimmerText without a spinner.",
    };
  }
  if (rowId === "ATT-02") {
    return {
      code: "v2-empty-attachments-state",
      evidence:
        "Frozen V1 exposes only a disabled empty Attachments chip; the product rule requires V2 to expose a routable empty Attachments state.",
    };
  }
  if (rowId === "ATT-07") {
    return {
      code: "v2-inline-video-player",
      evidence:
        "Frozen V1 downloads video attachments; the product rule requires V2 to open them in an inline player.",
    };
  }
  if (rowId === "ROW-04") {
    return {
      code: "v2-authoritative-waiting-input",
      evidence:
        "Frozen V1 exposes the generic Thread approval attention state; the product rule requires V2 to expose the authoritative Waiting for input state while preserving the same visual treatment.",
    };
  }
  if (rowId === "PORT-04") {
    return {
      code: "v2-bounded-tunnel-active",
      evidence:
        "Frozen V1 exposes native port forwarding and has no reachable bounded LocalhostPreview path when native forwarding is available; the V2 security contract requires a bounded active tunnel.",
    };
  }
  if (rowId === "PORT-05") {
    return {
      code: "v2-bounded-tunnel-create-pending",
      evidence:
        "Frozen V1 exposes an active native forward but no bounded creation state; the V2 security contract requires bounded tunnel creation and exposes its pending state.",
    };
  }
  if (rowId === "PORT-06") {
    return {
      code: "v2-bounded-tunnel-revoke-pending",
      evidence:
        "Frozen V1 exposes an active native forward but no bounded revocation state; the V2 security contract requires bounded tunnel revocation and exposes its pending state.",
    };
  }
  if (rowId === "PORT-07") {
    return {
      code: "v2-bounded-tunnel-expiry",
      evidence:
        "Frozen V1 native forwarding stays active and has no bounded expiry lifecycle; the V2 security contract requires a visible bounded tunnel expiry.",
    };
  }
  if (rowId === "TERM-07") {
    return {
      code: "v2-terminal-replay-recovery",
      evidence:
        "Frozen V1 exposes the raw replay-unavailable error and requires closing the tab; V2 explains the replay loss and provides an explicit retry that starts a new shell.",
    };
  }
  if (rowId === "TERM-08") {
    return {
      code: "v2-terminal-exit-lifecycle",
      evidence:
        "Frozen V1 preserves the selected terminal tab and output after exit without lifecycle metadata; V2 additionally exposes the exact terminal exit code.",
    };
  }
  if (rowId === "NEW-04") {
    return {
      code: "v2-new-thread-create-progress",
      evidence:
        "Frozen V1 exposes no visible or accessibility pending state while new-thread submission is held; the product rule requires V2 ShimmerText and duplicate-submit suppression.",
    };
  }
  if (rowId === "INT-05") {
    return {
      code: "v2-new-thread-action-progress",
      evidence:
        "Frozen V1 exposes no pending presentation for held new-thread submission or attachment upload; V2 exposes their real pending states while all other async-action captures remain strict.",
    };
  }
  return null;
}

function captureUsesIntentionalVisualDifference(rowId: string, state: string): boolean {
  if (rowId === "INT-05") {
    return (
      state.endsWith("-new-thread-create-pending") ||
      state.endsWith("-action-attachment-upload-pending")
    );
  }
  if (rowId === "LIST-21") return state.endsWith("-catalog-loading-more-policy");
  if (rowId === "PAGE-03") return state.endsWith("-history-loading-newer-policy");
  if (rowId === "DRAFT-01") return state.endsWith("-attachment-upload-pending-policy");
  if (rowId === "TERM-07") return state.endsWith("-terminal-replay-unavailable");
  return intentionalVisualDifference(rowId) !== null;
}

async function finalizeVisualParityEvidence(): Promise<void> {
  const matrix = await readFile(
    path.join(REPO_ROOT, "docs", "android-v2-visual-parity.md"),
    "utf8",
  );
  const matrixRows = matrix
    .split("\n")
    .filter((line) => /^\| [A-Z]+-\d+\s+\|/u.test(line))
    .map((line) => {
      const [id, v1State, v2Scenario, targets, audit, expectedStatus] = line
        .split("|")
        .slice(1, 7)
        .map((cell) => cell.trim());
      if (
        id === undefined ||
        id.length === 0 ||
        v1State === undefined ||
        v1State.length === 0 ||
        v2Scenario === undefined ||
        v2Scenario.length === 0 ||
        targets === undefined ||
        targets.length === 0 ||
        audit === undefined ||
        audit.length === 0 ||
        expectedStatus === undefined ||
        !["open", "diff", "pass", "intentional-difference"].includes(expectedStatus)
      ) {
        throw new Error(`Malformed visual parity matrix row: ${line}`);
      }
      return { audit, expectedStatus, id, targets, v1State, v2Scenario };
    });
  if (matrixRows.length !== 265 || new Set(matrixRows.map(({ id }) => id)).size !== 265) {
    throw new Error(
      `Visual parity matrix should contain 265 unique atomic rows, found ${matrixRows.length}`,
    );
  }
  const rowsById = new Map<
    string,
    {
      blocker?: ReturnType<typeof parityBlocker>;
      captures: Array<Record<string, unknown>>;
      expectedStatus: string;
      id: string;
      intentionalDifference?: NonNullable<ReturnType<typeof intentionalVisualDifference>>;
      status: string;
      targets: string;
      v1State: string;
      v2Scenario: string;
    }
  >(
    matrixRows.map((row) => {
      const intentionalDifference = intentionalVisualDifference(row.id);
      if ((row.expectedStatus === "intentional-difference") !== (intentionalDifference !== null)) {
        throw new Error(
          `Visual parity policy mismatch for ${row.id}: canonical status is ${row.expectedStatus}, harness policy is ${intentionalDifference?.code ?? "strict"}`,
        );
      }
      return [row.id, { ...row, blocker: parityBlocker(row.id), captures: [], status: "blocked" }];
    }),
  );
  const failures = [...visualParityMacroFailures];
  if (TARGET_FAMILY === null) {
    try {
      assertInteractionInventoryCoverage(
        [...visualParityCaptures.values()].map((capture) => ({
          rowId: capture.rowId,
          state: capture.state,
        })),
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const [, capture] of [...visualParityCaptures.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const row = rowsById.get(capture.rowId);
    if (row === undefined) {
      throw new Error(`Captured visual parity row is absent from the matrix: ${capture.rowId}`);
    }
    delete row.blocker;
    const base = { state: capture.state };
    if (capture.v1 === undefined || capture.v2 === undefined) {
      row.captures.push({
        ...base,
        status: "fail",
        ...(capture.v1 === undefined
          ? {}
          : { v1Screenshot: capture.v1.screenshot, v1Xml: capture.v1.xml }),
        ...(capture.v2 === undefined
          ? {}
          : { v2Screenshot: capture.v2.screenshot, v2Xml: capture.v2.xml }),
      });
      row.status = "fail";
      failures.push(`${capture.rowId}/${capture.state} was not captured in both V1 and V2`);
      continue;
    }
    const artifactPrefix = `${capture.rowId.toLowerCase()}-${capture.state}`;
    const diffImage = `${artifactPrefix}-diff.png`;
    const diffData = `${artifactPrefix}-diff.json`;
    const visualDiff = await writeVisualDiff({
      actualPath: path.join(parityArtifactDir, capture.v2.screenshot),
      baselinePath: path.join(parityArtifactDir, capture.v1.screenshot),
      diffPath: path.join(parityArtifactDir, diffImage),
    });
    await writeFile(
      path.join(parityArtifactDir, diffData),
      `${JSON.stringify(visualDiff, null, 2)}\n`,
      { mode: 0o600 },
    );
    const intentionalDifference = intentionalVisualDifference(capture.rowId);
    const captureIsIntentional = captureUsesIntentionalVisualDifference(
      capture.rowId,
      capture.state,
    );
    const status = !captureIsIntentional
      ? visualDiff.ratio > VISUAL_DIFF_MAX_RATIO
        ? "diff"
        : "pass"
      : "intentional-difference";
    if (intentionalDifference !== null) row.intentionalDifference = intentionalDifference;
    row.captures.push({
      ...base,
      diffData,
      diffImage,
      ratio: visualDiff.ratio,
      status,
      threshold: VISUAL_DIFF_MAX_RATIO,
      v1Screenshot: capture.v1.screenshot,
      v1Xml: capture.v1.xml,
      v2Screenshot: capture.v2.screenshot,
      v2Xml: capture.v2.xml,
    });
    if (row.status !== "fail") {
      if (status === "diff") row.status = "diff";
      else if (row.status !== "diff") {
        row.status = intentionalDifference === null ? "pass" : "intentional-difference";
      }
    }
    if (status === "diff") {
      failures.push(
        `${capture.rowId}/${capture.state} differs by ${(visualDiff.ratio * 100).toFixed(2)}%, maximum ${(VISUAL_DIFF_MAX_RATIO * 100).toFixed(2)}%`,
      );
    }
  }
  if (TARGET_FAMILY === null) {
    for (const row of rowsById.values()) {
      if (row.targets !== "phone, wide" || row.status === "blocked" || row.status === "fail") {
        continue;
      }
      const states = row.captures.flatMap((capture) =>
        typeof capture.state === "string" ? [capture.state] : [],
      );
      const missingLayouts = ["phone", "wide"].filter(
        (layout) => !states.some((state) => state.startsWith(`${layout}-`)),
      );
      if (missingLayouts.length === 0) continue;
      row.status = "fail";
      failures.push(
        `${row.id} lacks dedicated ${missingLayouts.join(" and ")} capture required by its phone, wide target`,
      );
    }
  }
  const rows = [...rowsById.values()];
  for (const row of rows) {
    const intentionalDifference = intentionalVisualDifference(row.id);
    if (
      intentionalDifference !== null &&
      !row.captures.some((capture) => capture.status === "intentional-difference")
    ) {
      if (TARGET_FAMILY !== null && row.captures.length === 0) continue;
      row.status = "fail";
      failures.push(`${row.id} has no capture of its exact intentional product difference`);
      continue;
    }
    if (row.status !== "blocked") continue;
    if (TARGET_FAMILY !== null) continue;
    failures.push(
      `${row.id} has no complete real paired evidence: ${row.blocker?.code ?? "missing blocker evidence"}`,
    );
  }
  const coveredRows = rows.filter(
    (row) => row.status === "pass" || row.status === "intentional-difference",
  ).length;
  const blockedRows = rows.filter((row) => row.status === "blocked").length;
  await writeFile(
    path.join(parityArtifactDir, "evidence.json"),
    `${JSON.stringify(
      { blockedRows, coveredRows, matrixRows: matrixRows.length, rows, schemaVersion: 1 },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  observe(
    "visualParityAtomicRows",
    "appiumScreenshotsAndPixelDiff",
    `${coveredRows}/${matrixRows.length} exact rows passed; ${blockedRows} carry explicit blockers`,
  );
  if (failures.length > 0) throw new Error(failures.join("; "));
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

async function readGlobalSetting(
  device: AndroidDevice,
  key: string,
): Promise<AndroidGlobalSetting> {
  const value = (await adb(device, REPO_ROOT, ["shell", "settings", "get", "global", key])).trim();
  return value === "null" ? { exists: false } : { exists: true, value };
}

async function restoreGlobalSetting(
  device: AndroidDevice,
  key: string,
  previous: AndroidGlobalSetting,
): Promise<void> {
  if (previous.exists) {
    await adb(device, REPO_ROOT, ["shell", "settings", "put", "global", key, previous.value]);
    return;
  }
  await adb(device, REPO_ROOT, ["shell", "settings", "delete", "global", key]);
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
    COMPANION_PATH,
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
): Promise<string> {
  const control = ["--control-endpoint", controlEndpoint, "--token-file", tokenFile];
  const result = await runCommand(
    COMPANION_PATH,
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
      COMPANION_PATH,
      ["scopes", deviceId, scopes.join(","), ...control],
      { cwd: REPO_ROOT },
    );
  });
  return deviceId;
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

async function restartAndroidConnectionService(device: AndroidDevice): Promise<void> {
  await stopAndroidConnectionService(device);
  // Simulate LMK after Home: the service must recover V2 notification authority
  // from durable native state without relying on the old React runtime.
  await adb(device, REPO_ROOT, ["shell", "am", "kill", PACKAGE_NAME]);
  await delay(500);
  await adb(device, REPO_ROOT, [
    "shell",
    "am",
    "start-foreground-service",
    "-n",
    `${PACKAGE_NAME}/dev.codewide.app.remote.CodexConnectionService`,
  ]);
  await delay(1_000);
}

async function reconnectAndroidConnectionServiceInPlace(device: AndroidDevice): Promise<void> {
  await stopAndroidConnectionService(device);
  await adb(device, REPO_ROOT, [
    "shell",
    "am",
    "start-foreground-service",
    "-n",
    `${PACKAGE_NAME}/dev.codewide.app.remote.CodexConnectionService`,
  ]);
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

async function readRunningAvd(device: AndroidDevice): Promise<string | null> {
  if (!device.serial.startsWith("emulator-")) return null;
  const avd = (await adb(device, REPO_ROOT, ["shell", "getprop", "ro.boot.qemu.avd_name"])).trim();
  return avd === "" ? null : avd;
}

function requireTargetAvd(actualAvd: string | null): void {
  if (TARGET_FAMILY === null) return;
  const expected = ANDROID_E2E_TARGETS[TARGET_FAMILY];
  if (process.env.CODEWIDE_E2E_AVD?.trim() !== expected || actualAvd !== expected) {
    throw new Error(
      `Android E2E ${TARGET_FAMILY} shard requires AVD ${expected}, received ${actualAvd ?? "unknown"}`,
    );
  }
}

function requireExpectedFingerprint(
  label: string,
  actual: string,
  expected: string | null,
): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actual)) throw new Error(`${label} fingerprint is invalid`);
  if (expected !== null && actual !== expected) {
    throw new Error(`${label} fingerprint differs from the orchestrator lock`);
  }
}

function readTargetFamilyEnvironment(): AndroidE2eTargetFamily | null {
  const value = process.env.CODEWIDE_E2E_TARGET_FAMILY?.trim();
  if (value === undefined || value === "") return null;
  if (value !== "phone" && value !== "fold") {
    throw new Error("CODEWIDE_E2E_TARGET_FAMILY must be phone or fold");
  }
  return value;
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

function readRatioEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return parsed;
}

function readPositiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}
