import { createHash } from "node:crypto";
import { chmod, mkdir, open, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parsePairingPayload } from "../packages/codex-protocol/src/pairing.ts";

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
  type LayoutEvidence,
} from "./android-device-gate-lib.ts";

const PACKAGE_NAME = "dev.codexremote.app";
const ACTIVITY = `${PACKAGE_NAME}/dev.codewide.app.MainActivity`;
const OUTPUT_ROOT = path.resolve("test-results/android-device");
const ALL_SUITES = ["smoke", "lifecycle", "layout", "upgrade"] as const;
type Suite = typeof ALL_SUITES[number];

type Options = {
  serial: string;
  apk: string;
  previousApk: string | null;
  suites: Set<Suite>;
  outputDir: string;
  captureScreenshot: boolean;
  expectedServerCount: number | null;
  pairingFile: string | null;
  dryRun: boolean;
};

type StepEvidence = {
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: Record<string, unknown>;
  error?: string;
};

const options = parseOptions(process.argv.slice(2));
if (options.dryRun) {
  process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, plan: plannedSteps(options) }, null, 2)}\n`);
  process.exit(0);
}

await validateOptions(options);
await mkdir(options.outputDir, { recursive: true, mode: 0o700 });
await chmod(options.outputDir, 0o700);

const startedAt = Date.now();
const steps: StepEvidence[] = [];
let passed = false;
let failure: string | null = null;
let layout: LayoutEvidence | null = null;
let device: Record<string, unknown> | null = null;
let packageBeforeUpgrade: ReturnType<typeof parsePackageFacts> | null = null;
let packageAfterUpgrade: ReturnType<typeof parsePackageFacts> | null = null;
const launches: Array<ReturnType<typeof parseStartTiming>> = [];
const screenshots: string[] = [];

try {
  await step("device-prerequisites", async () => {
    const devices = runHost("adb", ["devices", "-l"]);
    if (adbDeviceState(devices, options.serial) !== "device") {
      throw new Error("The explicitly selected ADB serial is not present in device state");
    }
    const state = adb(["get-state"]).trim();
    if (state !== "device") throw new Error(`ADB target is not ready: ${state}`);
    const model = adb(["shell", "getprop", "ro.product.model"]).trim();
    const apiLevel = integer(adb(["shell", "getprop", "ro.build.version.sdk"]).trim(), "Android API level");
    const fingerprint = adb(["shell", "getprop", "ro.build.fingerprint"]).trim();
    device = {
      serialSha256: sha256(options.serial),
      model,
      apiLevel,
      buildFingerprintSha256: sha256(fingerprint),
    };
    return { model, apiLevel };
  });

  // Keep crash evidence scoped to this exact run. The crash buffer survives
  // package reinstalls and otherwise makes a fixed build look broken.
  adb(["logcat", "-b", "crash", "-c"]);

  if (options.suites.has("upgrade")) {
    await step("install-previous-apk-preserving-data", async () => {
      adb(["install", "-r", options.previousApk!], 120_000);
      packageBeforeUpgrade = packageFacts();
      const launch = launchApp();
      launches.push(launch);
      assertLaunch(launch);
      return {
        apk: path.basename(options.previousApk!),
        versionName: packageBeforeUpgrade.versionName,
        versionCode: packageBeforeUpgrade.versionCode,
      };
    });
    if (options.pairingFile !== null) await pairTestServer();
  }

  if (options.suites.has("smoke") || options.suites.has("lifecycle") || options.suites.has("layout") || options.suites.has("upgrade")) {
    await step("install-current-apk-preserving-data", async () => {
      adb(["install", "-r", options.apk], 120_000);
      const facts = packageFacts();
      if (options.suites.has("upgrade")) {
        packageAfterUpgrade = facts;
        if (packageBeforeUpgrade?.userId === null || facts.userId !== packageBeforeUpgrade?.userId) {
          throw new Error("Application UID changed during upgrade");
        }
        if (packageBeforeUpgrade.firstInstallTime === null || facts.firstInstallTime !== packageBeforeUpgrade.firstInstallTime) {
          throw new Error("First install time changed; upgrade behaved like a fresh install");
        }
      }
      return { apk: path.basename(options.apk), versionName: facts.versionName, versionCode: facts.versionCode };
    });

    await step("cold-launch", async () => {
      const launch = launchApp();
      launches.push(launch);
      assertLaunch(launch);
      await delay(2_000);
      const pid = adb(["shell", "pidof", PACKAGE_NAME]).trim();
      if (pid === "") throw new Error("Application process is absent after successful launch");
      return launch;
    });
    if (!options.suites.has("upgrade") && options.pairingFile !== null) await pairTestServer();
    if (options.suites.has("upgrade") && options.expectedServerCount !== null) {
      await step("connection-preserved-after-upgrade", async () => {
        const serverCount = await detectServerCount();
        if (serverCount !== options.expectedServerCount) {
          throw new Error(`Expected ${options.expectedServerCount} preserved server controls, found ${serverCount}`);
        }
        return { serverCount };
      });
    }
  }

  if (options.suites.has("lifecycle")) {
    await step("screen-sleep-wake", async () => {
      adb(["shell", "input", "keyevent", "KEYCODE_SLEEP"]);
      await delay(2_000);
      adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
      adb(["shell", "wm", "dismiss-keyguard"]);
      await delay(2_000);
      return { processAlive: adb(["shell", "pidof", PACKAGE_NAME], 60_000, true).trim() !== "" };
    });

    await step("doze-recovery", async () => {
      adb(["shell", "dumpsys", "battery", "unplug"]);
      adb(["shell", "dumpsys", "deviceidle", "force-idle"]);
      await delay(3_000);
      const idleState = adb(["shell", "dumpsys", "deviceidle", "get", "deep"]).trim();
      if (!/idle/i.test(idleState)) throw new Error(`Device did not enter deep idle: ${idleState}`);
      adb(["shell", "dumpsys", "deviceidle", "unforce"]);
      adb(["shell", "dumpsys", "battery", "reset"]);
      adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
      adb(["shell", "wm", "dismiss-keyguard"]);
      await delay(3_000);
      return { idleState };
    });

    await step("app-standby-recovery", async () => {
      // `set-inactive` is ignored while our required foreground connection
      // service is alive on API 35. Standby buckets are the supported,
      // observable control surface and still let us prove foreground recovery.
      adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
      await delay(1_000);
      adb(["shell", "am", "set-standby-bucket", PACKAGE_NAME, "rare"]);
      const standbyBucket = adb(["shell", "am", "get-standby-bucket", PACKAGE_NAME]).trim();
      if (standbyBucket !== "40") throw new Error(`Rare standby bucket was not applied: ${standbyBucket}`);
      const launch = launchApp();
      launches.push(launch);
      assertLaunch(launch);
      await delay(1_000);
      const resumedBucket = adb(["shell", "am", "get-standby-bucket", PACKAGE_NAME]).trim();
      if (resumedBucket !== "10") throw new Error(`Foreground launch did not restore the active bucket: ${resumedBucket}`);
      return { standbyBucketBeforeResume: standbyBucket, standbyBucketAfterResume: resumedBucket };
    });

    await step("process-kill-recreation", async () => {
      adb(["shell", "am", "force-stop", PACKAGE_NAME]);
      await delay(1_000);
      const stoppedPid = adb(["shell", "pidof", PACKAGE_NAME], 60_000, true).trim();
      if (stoppedPid !== "") throw new Error("Application process survived am force-stop");
      const launch = launchApp();
      launches.push(launch);
      assertLaunch(launch);
      // The FTS close crash this gate caught occurred about 11 seconds after
      // recreation. A PID check alone passed because Android restarted the
      // foreground service after the activity died, so require a stable,
      // resumed activity beyond that window and inspect the native crash log.
      await delay(15_000);
      const resumedPid = adb(["shell", "pidof", PACKAGE_NAME]).trim();
      if (resumedPid === "") throw new Error("Application process did not return after recreation");
      const activities = adb(["shell", "dumpsys", "activity", "activities"]);
      if (!isAppTopResumed(activities, PACKAGE_NAME)) {
        throw new Error("Application activity is not top-resumed after recreation stability window");
      }
      const crashLog = adb(["logcat", "-b", "crash", "-d", "-v", "brief"]);
      if (containsPackageCrash(crashLog, PACKAGE_NAME)) {
        throw new Error("Application produced a native crash during lifecycle recovery");
      }
      return { ...launch, stableForMs: 15_000, topResumed: true, nativeCrash: false };
    });
  }

  if (options.suites.has("layout")) {
    await step("adaptive-layout-accessibility-geometry", async () => {
      let listXml = "";
      let listNodes: ReturnType<typeof parseUiNodes> = [];
      const initialNodes = parseUiNodes(captureUiXml());
      if (initialNodes.some(({ description }) => description === "Back to threads")) {
        // A lifecycle run can legitimately restore the last opened compact
        // conversation. Normalize to the list before asserting phone layout.
        tapDescription("Back to threads");
        await delay(500);
      }
      // A large first snapshot can commit just after the cold-launch process is
      // already healthy. Wait for the Telegram-like list to become actionable
      // instead of racing one accessibility dump against cache hydration.
      for (let attempt = 0; attempt < 120; attempt += 1) {
        listXml = captureUiXml();
        listNodes = parseUiNodes(listXml);
        if (
          compactThreadControl(listNodes) !== null ||
          listNodes.some(({ description }) => description === "Composer menu")
        ) break;
        await delay(500);
      }
      const conversationAlreadyOpen = listNodes.some(({ description }) => description === "Composer menu");
      if (!conversationAlreadyOpen && compactThreadControl(listNodes) === null) {
        throw new Error("No compact thread control is available for layout validation");
      }
      const verifiedServerCount = await detectServerCount(listNodes);
      if (options.expectedServerCount !== null && verifiedServerCount !== options.expectedServerCount) {
        throw new Error(`Expected ${options.expectedServerCount} server controls, found ${verifiedServerCount}`);
      }
      // On phones the Telegram-like list and conversation are intentionally
      // separate screens. Select the first visible thread, then validate the
      // full-width composer against the preserved list/search/server geometry.
      let conversationXml: string | undefined;
      if (!conversationAlreadyOpen) {
        const threadControl = compactThreadControl(listNodes);
        if (threadControl === null) throw new Error("Compact thread control disappeared before selection");
        tapNode(threadControl);
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await delay(500);
          const candidate = captureUiXml();
          if (parseUiNodes(candidate).some(({ description }) => description === "Composer menu")) {
            conversationXml = candidate;
            break;
          }
        }
        if (conversationXml === undefined) throw new Error("Compact conversation did not open before the layout deadline");
      }
      layout = analyzeAdaptiveLayout(listXml, conversationXml);
      layout.serverControls.serverCount = verifiedServerCount;
      if (options.captureScreenshot) {
        const screenshotName = "adaptive-layout.png";
        const screenshotPath = path.join(options.outputDir, screenshotName);
        await writeFile(screenshotPath, adbBinary(["exec-out", "screencap", "-p"]), { mode: 0o600 });
        await chmod(screenshotPath, 0o600);
        screenshots.push(screenshotName);
      }
      return {
        screenWidth: layout.screenWidth,
        composerInputShare: layout.composer.inputShare,
        serverCount: layout.serverControls.serverCount,
      };
    });
  }

  await step("release-runtime-snapshot", async () => {
    const meminfo = adb(["shell", "dumpsys", "meminfo", PACKAGE_NAME]);
    const totalPssKb = optionalInteger(/^\s*TOTAL\s+(\d+)/m.exec(meminfo)?.[1] ?? null);
    const services = adb(["shell", "dumpsys", "activity", "services", PACKAGE_NAME]);
    return {
      totalPssKb,
      foregroundConnectionServicePresent: services.includes("CodexConnectionService"),
    };
  });

  passed = true;
} catch (error) {
  failure = safeError(error);
  process.exitCode = 1;
} finally {
  // Always restore device-global state even after a failed assertion.
  adb(["shell", "dumpsys", "deviceidle", "unforce"], 60_000, true);
  adb(["shell", "dumpsys", "battery", "reset"], 60_000, true);
  adb(["shell", "am", "set-inactive", PACKAGE_NAME, "false"], 60_000, true);
  adb(["shell", "am", "set-standby-bucket", PACKAGE_NAME, "active"], 60_000, true);
  adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"], 60_000, true);
  adb(["shell", "wm", "dismiss-keyguard"], 60_000, true);

  const artifact = {
    schemaVersion: 1,
    passed,
    error: failure,
    startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    suites: [...options.suites],
    device,
    currentApk: path.basename(options.apk),
    previousApk: options.previousApk === null ? null : path.basename(options.previousApk),
    pairingAutomated: options.pairingFile !== null,
    packageBeforeUpgrade,
    packageAfterUpgrade,
    launches,
    layout,
    screenshots,
    steps,
  };
  const artifactPath = path.join(options.outputDir, "evidence.json");
  const temporaryPath = `${artifactPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, artifactPath);
  process.stdout.write(`${JSON.stringify({ passed, artifact: path.relative(process.cwd(), artifactPath), steps: steps.length, error: failure })}\n`);
}

async function step(name: string, action: () => Promise<Record<string, unknown>>): Promise<void> {
  const started = Date.now();
  try {
    const detail = await action();
    steps.push({ name, ok: true, durationMs: Date.now() - started, detail });
  } catch (error) {
    const message = safeError(error);
    steps.push({ name, ok: false, durationMs: Date.now() - started, error: message });
    throw error;
  }
}

function launchApp(): ReturnType<typeof parseStartTiming> {
  return parseStartTiming(adb(["shell", "am", "start", "-W", "-S", "-n", ACTIVITY]));
}

function assertLaunch(launch: ReturnType<typeof parseStartTiming>): void {
  if (launch.status !== "ok") throw new Error(`Activity launch failed: ${launch.status ?? "missing status"}`);
  if (launch.totalTimeMs === null) throw new Error("Activity launch did not report TotalTime");
}

function packageFacts(): ReturnType<typeof parsePackageFacts> {
  const output = adb(["shell", "dumpsys", "package", PACKAGE_NAME]);
  const facts = parsePackageFacts(output);
  if (facts.versionName === null || facts.versionCode === null || facts.userId === null) {
    throw new Error("Installed package metadata is incomplete");
  }
  return facts;
}

async function pairTestServer(): Promise<void> {
  await step("one-time-pairing", async () => {
    const pairing = await readPairing(options.pairingFile!);
    adb(["shell", "pm", "grant", PACKAGE_NAME, "android.permission.POST_NOTIFICATIONS"], 60_000, true);
    await tapDescriptionWhenReady("Add server", 15_000);
    await delay(500);
    if (hasDescription("Open manual server setup")) {
      tapDescription("Open manual server setup");
      await delay(500);
    }
    await inputDescriptionWhenReady("Server name", pairing.displayName);
    await inputDescriptionWhenReady("Server endpoint", pairing.endpoint);
    await inputDescriptionWhenReady("One-time pairing token", pairing.pairingToken);
    if (pairing.tlsPinSha256 !== undefined) await inputDescriptionWhenReady("TLS certificate pin", pairing.tlsPinSha256);
    await tapDescriptionWithScroll(["Connect server manually", "Save server"], 10_000);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(750);
      const nodes = parseUiNodes(captureUiXml());
      if (!nodes.some(({ description }) => description === "Save server" || description === "Connect server manually")) {
        const serverCount = await detectServerCount(nodes);
        if (serverCount < 1) throw new Error("Pairing sheet closed but no server control is visible");
        return { paired: true, serverCount };
      }
    }
    throw new Error("Pairing did not complete before the one-time UI deadline");
  });
}

async function tapDescriptionWhenReady(description: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = parseUiNodes(captureUiXml()).find((candidate) => candidate.description === description);
    if (node !== undefined) {
      tapNode(node);
      return;
    }
    await delay(250);
  }
  throw new Error(`Missing accessibility node after ${timeoutMs} ms: ${description}`);
}

function hasDescription(description: string): boolean {
  return parseUiNodes(captureUiXml()).some((candidate) => candidate.description === description);
}

async function inputDescriptionWhenReady(description: string, value: string): Promise<void> {
  await tapDescriptionWhenReady(description, 10_000);
  adb(["shell", "input", "text", value.replaceAll("%", "%25").replaceAll(" ", "%s")]);
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
}

async function tapDescriptionWithScroll(descriptions: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const node = parseUiNodes(captureUiXml()).find((candidate) => descriptions.includes(candidate.description));
    if (node !== undefined) {
      tapNode(node);
      return;
    }
    adb(["shell", "input", "swipe", "540", "2200", "540", "1450", "300"]);
    await delay(300);
  }
  throw new Error(`Missing accessibility node after scrolling for ${timeoutMs} ms: ${descriptions.join(" or ")}`);
}

async function detectServerCount(initialNodes?: ReturnType<typeof parseUiNodes>): Promise<number> {
  const nodes = initialNodes ?? parseUiNodes(captureUiXml());
  const visibleCount = serverControlCount(nodes);
  if (visibleCount > 0) return visibleCount;
  if (!nodes.some(({ description }) => description === "Choose server")) return 0;
  tapDescription("Choose server");
  await delay(500);
  const compactCount = serverControlCount(parseUiNodes(captureUiXml()));
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  // The compact server chooser closes with an animation. Tapping a thread in
  // the same frame is swallowed by the departing modal scrim.
  await delay(500);
  return compactCount;
}

function tapDescription(description: string): void {
  const node = parseUiNodes(captureUiXml()).find((candidate) => candidate.description === description);
  if (node === undefined) throw new Error(`Missing accessibility node: ${description}`);
  tapNode(node);
}

function tapNode(node: { bounds: { left: number; top: number; right: number; bottom: number } }): void {
  const x = Math.floor((node.bounds.left + node.bounds.right) / 2);
  const y = Math.floor((node.bounds.top + node.bounds.bottom) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

function inputDescription(description: string, value: string): void {
  tapDescription(description);
  adb(["shell", "input", "text", value.replaceAll("%", "%25").replaceAll(" ", "%s")]);
  // Keep the next accessibility target out from under the soft keyboard. Without
  // this, ADB taps can land on the IME and all subsequent values stay in the
  // first focused TextInput.
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
}

function captureUiXml(): string {
  const remoteXml = `/data/local/tmp/codewide-ui-${process.pid}.xml`;
  try {
    adb(["shell", "uiautomator", "dump", "--compressed", remoteXml]);
    return adb(["exec-out", "cat", remoteXml]);
  } finally {
    adb(["shell", "rm", "-f", remoteXml], 60_000, true);
  }
}

function adb(args: string[], timeout = 60_000, allowFailure = false): string {
  return runHost("adb", ["-s", options.serial, ...args], timeout, allowFailure);
}

function adbBinary(args: string[], timeout = 60_000): Buffer {
  const result = spawnSync("adb", ["-s", options.serial, ...args], { encoding: "buffer", timeout, maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`ADB binary command failed with exit ${result.status ?? "unknown"}`);
  return result.stdout;
}

function runHost(command: string, args: string[], timeout = 60_000, allowFailure = false): string {
  const result = spawnSync(command, args, { encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const output = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(`${command} failed with exit ${result.status ?? "unknown"}: ${redact(output)}`);
  }
  return result.stdout;
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    if (argument === "--dry-run" || argument === "--capture-screenshot") {
      flags.add(argument.slice(2));
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    values.set(argument.slice(2), next);
    index += 1;
  }

  const serial = values.get("serial") ?? "";
  const apk = path.resolve(values.get("apk") ?? "apps/android/android/app/build/outputs/apk/release/app-release.apk");
  const previousApk = values.has("previous-apk") ? path.resolve(values.get("previous-apk")!) : null;
  const rawSuites = (values.get("suite") ?? "smoke,lifecycle,layout").split(",").filter(Boolean);
  const suites = new Set<Suite>();
  for (const suite of rawSuites) {
    if (!ALL_SUITES.includes(suite as Suite)) throw new Error(`Unknown suite: ${suite}`);
    suites.add(suite as Suite);
  }
  if (suites.size === 0) throw new Error("At least one suite is required");
  if (suites.has("upgrade") && previousApk === null) throw new Error("--previous-apk is required for the upgrade suite");

  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputDir = path.resolve(values.get("output") ?? path.join(OUTPUT_ROOT, timestamp));
  const relativeOutput = path.relative(OUTPUT_ROOT, outputDir);
  if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
    throw new Error("--output must remain under test-results/android-device");
  }

  const expectedServerCount = values.has("expected-server-count")
    ? positiveInteger(values.get("expected-server-count")!, "expected server count")
    : null;
  const pairingFile = values.has("pairing-file") ? path.resolve(values.get("pairing-file")!) : null;
  if (!flags.has("dry-run") && serial === "") throw new Error("--serial is required to select one exact device");

  return {
    serial,
    apk,
    previousApk,
    suites,
    outputDir,
    captureScreenshot: flags.has("capture-screenshot"),
    expectedServerCount,
    pairingFile,
    dryRun: flags.has("dry-run"),
  };
}

async function validateOptions(value: Options): Promise<void> {
  await requireApk(value.apk, "current APK");
  if (value.previousApk !== null) await requireApk(value.previousApk, "previous APK");
  if (value.pairingFile !== null) {
    const metadata = await stat(value.pairingFile).catch(() => null);
    if (metadata === null || !metadata.isFile()) throw new Error("pairing file does not exist");
    if ((metadata.mode & 0o077) !== 0) throw new Error("pairing file must not be accessible by group or other users");
  }
}

async function requireApk(file: string, label: string): Promise<void> {
  if (path.extname(file) !== ".apk") throw new Error(`${label} must have an .apk extension`);
  const metadata = await stat(file).catch(() => null);
  if (metadata === null || !metadata.isFile()) throw new Error(`${label} does not exist`);
  const handle = await open(file, "r");
  const header = Buffer.alloc(4);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header.length !== 4 || header[0] !== 0x50 || header[1] !== 0x4b) throw new Error(`${label} is not an APK/ZIP file`);
}

function plannedSteps(value: Options): string[] {
  const result = ["device-prerequisites"];
  if (value.suites.has("upgrade")) result.push("install-previous-apk-preserving-data");
  if (value.suites.has("upgrade") && value.pairingFile !== null) result.push("one-time-pairing");
  result.push("install-current-apk-preserving-data", "cold-launch");
  if (!value.suites.has("upgrade") && value.pairingFile !== null) result.push("one-time-pairing");
  if (value.suites.has("lifecycle")) result.push("screen-sleep-wake", "doze-recovery", "app-standby-recovery", "process-kill-recreation");
  if (value.suites.has("layout")) result.push("adaptive-layout-accessibility-geometry");
  result.push("release-runtime-snapshot");
  return result;
}

async function readPairing(file: string): Promise<ReturnType<typeof parsePairingPayload>> {
  const content = await readFileSafely(file);
  const firstLine = content.split("\n").find((line) => line.trim().startsWith("{"));
  if (firstLine === undefined) throw new Error("pairing file contains no JSON object");
  const parsed = JSON.parse(firstLine) as { pairingPayload?: unknown };
  if (typeof parsed.pairingPayload !== "string") throw new Error("pairing file contains no pairingPayload");
  const pairing = parsePairingPayload(parsed.pairingPayload);
  assertShellSafeAutomationPairing(pairing);
  return pairing;
}

async function readFileSafely(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function integer(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is not an integer`);
  return parsed;
}

function optionalInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function redact(value: string): string {
  let redacted = value
    .replaceAll(options.serial, "<device>")
    .replaceAll(options.apk, `<apk:${path.basename(options.apk)}>`)
    .replace(/\/(?:home|Users)\/[A-Za-z0-9._-]+\//g, "<private-home>/")
    .slice(0, 2_000);
  if (options.previousApk !== null) {
    redacted = redacted.replaceAll(options.previousApk, `<apk:${path.basename(options.previousApk)}>`);
  }
  return redacted;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
