import { copyFile, cp, chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ANDROID_E2E_TARGETS,
  loadAndroidE2eShard,
  mergeAndroidE2eEvidence,
  sha256File,
  type AndroidE2eTargetFamily,
  type MergedAndroidE2eEvidence,
} from "./android-e2e/mergedEvidence.ts";
import { runCommand, type CommandResult } from "./android-e2e/process.ts";
import {
  computeSourceFingerprint,
  requireStableSourceFingerprint,
} from "./android-e2e/sourceFingerprint.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const APK_PATH = path.join(
  REPO_ROOT,
  "apps/android/android/app/build/outputs/apk/e2e/app-e2e.apk",
);
const COMPANION_PATH = path.join(REPO_ROOT, "target/debug/codewide-companion");
const RUN_TIMEOUT_MS = 3_600_000;
const runId = `${timestamp()}-${crypto.randomUUID().slice(0, 8)}-matrix`;
const artifactRoot = path.join(REPO_ROOT, "test-results", "android-e2e", runId);
const apkArtifact = "binaries/app-e2e.apk";
const companionArtifact = "binaries/codewide-companion";

type ShardRun = {
  artifactPrefix: string;
  family: AndroidE2eTargetFamily;
  result: CommandResult;
};

await main();

async function main(): Promise<void> {
  await mkdir(path.join(artifactRoot, "binaries"), { mode: 0o700, recursive: true });
  await mkdir(path.join(artifactRoot, "runner-logs"), { mode: 0o700, recursive: true });
  await assertManagedAppServer();
  await assertMatrixEnvironment();
  const sourceFingerprint = await computeSourceFingerprint(REPO_ROOT);
  let apkSha256 = emptyDigest();
  let companionSha256 = emptyDigest();
  const shardRuns: ShardRun[] = [];
  let failure: Error | null = null;
  try {
    await assertAvdsExist();
    await assertNoConnectedAndroidDevices();
    await runBuild("Companion", "cargo", [
      "build",
      "-p",
      "codewide-companion",
      "--features",
      "e2e-command-fault",
    ], 600_000, { CARGO_INCREMENTAL: "0" });
    await runBuild(
      "Android E2E APK",
      "sh",
      ["scripts/android-gradle.sh", ":app:assembleE2e"],
      900_000,
    );
    requireStableSourceFingerprint(
      sourceFingerprint,
      await computeSourceFingerprint(REPO_ROOT),
    );
    await Promise.all([
      copyLockedArtifact(APK_PATH, path.join(artifactRoot, apkArtifact)),
      copyLockedArtifact(COMPANION_PATH, path.join(artifactRoot, companionArtifact)),
    ]);
    [apkSha256, companionSha256] = await Promise.all([
      sha256File(path.join(artifactRoot, apkArtifact)),
      sha256File(path.join(artifactRoot, companionArtifact)),
    ]);
    for (const family of ["phone", "fold"] as const) {
      await assertNoConnectedAndroidDevices();
      await assertFingerprintLock(sourceFingerprint, apkSha256, companionSha256);
      const shard = await runShard(family, sourceFingerprint, apkSha256, companionSha256);
      shardRuns.push(shard);
      await assertFingerprintLock(sourceFingerprint, apkSha256, companionSha256);
    }
    const shards = await Promise.all(
      shardRuns.map((shard) => loadAndroidE2eShard(artifactRoot, shard.artifactPrefix)),
    );
    const evidence = await mergeAndroidE2eEvidence({
      apkArtifact,
      artifactRoot,
      companionArtifact,
      completedAt: new Date().toISOString(),
      runId,
      shards,
      sourceFingerprint,
    });
    await writeEvidence(evidence);
    printResult(evidence);
  } catch (cause) {
    failure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (failure === null) return;
  const evidence = failureEvidence(
    sourceFingerprint,
    apkSha256,
    companionSha256,
    shardRuns,
    failure.message,
  );
  await writeEvidence(evidence);
  printResult(evidence);
  throw failure;
}

async function runBuild(
  label: string,
  command: string,
  args: string[],
  timeoutMs: number,
  extraEnvironment: NodeJS.ProcessEnv = {},
): Promise<void> {
  process.stdout.write(`[android-e2e-matrix] Building ${label}\n`);
  const result = await runCommand(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...extraEnvironment },
    timeoutMs,
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
}

async function runShard(
  family: AndroidE2eTargetFamily,
  sourceFingerprint: string,
  apkSha256: string,
  companionSha256: string,
): Promise<ShardRun> {
  process.stdout.write(
    `[android-e2e-matrix] Running ${family} shard on ${ANDROID_E2E_TARGETS[family]}\n`,
  );
  const environment = { ...process.env };
  delete environment.CODEWIDE_E2E_SERIAL;
  Object.assign(environment, {
    CODEWIDE_E2E_AVD: ANDROID_E2E_TARGETS[family],
    CODEWIDE_E2E_EXPECTED_APK_SHA256: apkSha256,
    CODEWIDE_E2E_EXPECTED_COMPANION_SHA256: companionSha256,
    CODEWIDE_E2E_EXPECTED_SOURCE_FINGERPRINT: sourceFingerprint,
    CODEWIDE_E2E_TARGET_FAMILY: family,
    CODEWIDE_LIVE_E2E: "1",
  });
  const args = ["exec", "tsx", "scripts/android-e2e.ts", "--skip-build"];
  if (family === "phone") args.push("--phone-visual-parity");
  const result = await runCommand("pnpm", args, {
    allowFailure: true,
    cwd: REPO_ROOT,
    env: environment,
    timeoutMs: RUN_TIMEOUT_MS,
  });
  await Promise.all([
    writeLog(path.join(artifactRoot, "runner-logs", `${family}.stdout.log`), result.stdout),
    writeLog(path.join(artifactRoot, "runner-logs", `${family}.stderr.log`), result.stderr),
  ]);
  const sourceArtifact = await parseShardArtifact(result.stdout);
  const artifactPrefix = `shards/${family}`;
  await copyShardArtifact(sourceArtifact, path.join(artifactRoot, artifactPrefix));
  if (result.exitCode !== 0) {
    process.stderr.write(
      `[android-e2e-matrix] ${family} shard exited with ${String(result.exitCode)}; continuing only to collect the other real shard\n`,
    );
  }
  return { artifactPrefix, family, result };
}

async function parseShardArtifact(stdout: string): Promise<string> {
  const lines = stdout.split("\n").toReversed();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (isRecord(value) && typeof value.artifact === "string") {
        const evidencePath = resolveRepoRelative(value.artifact);
        if (path.basename(evidencePath) !== "evidence.json") {
          throw new Error("Android E2E shard reported a non-evidence artifact");
        }
        return path.dirname(evidencePath);
      }
    } catch (cause) {
      if (cause instanceof SyntaxError) continue;
      throw cause;
    }
  }
  throw new Error("Android E2E shard did not report its evidence artifact");
}

async function copyShardArtifact(source: string, destination: string): Promise<void> {
  const sourceReal = await realpath(source);
  const allowedRoot = await realpath(path.join(REPO_ROOT, "test-results", "android-e2e"));
  if (sourceReal === allowedRoot || !sourceReal.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error("Android E2E shard artifact escaped test-results/android-e2e");
  }
  if (!(await stat(sourceReal)).isDirectory()) {
    throw new Error("Android E2E shard artifact is not a directory");
  }
  await cp(sourceReal, destination, { errorOnExist: true, recursive: true, verbatimSymlinks: true });
}

async function copyLockedArtifact(source: string, destination: string): Promise<void> {
  if (!(await stat(source)).isFile()) throw new Error(`Locked build artifact is missing: ${source}`);
  await copyFile(source, destination);
  await chmod(destination, 0o400);
}

async function assertFingerprintLock(
  sourceFingerprint: string,
  apkSha256: string,
  companionSha256: string,
): Promise<void> {
  requireStableSourceFingerprint(sourceFingerprint, await computeSourceFingerprint(REPO_ROOT));
  const [currentApk, currentCompanion, copiedApk, copiedCompanion] = await Promise.all([
    sha256File(APK_PATH),
    sha256File(COMPANION_PATH),
    sha256File(path.join(artifactRoot, apkArtifact)),
    sha256File(path.join(artifactRoot, companionArtifact)),
  ]);
  if (currentApk !== apkSha256 || copiedApk !== apkSha256) {
    throw new Error("Android E2E APK changed after the matrix fingerprint lock");
  }
  if (currentCompanion !== companionSha256 || copiedCompanion !== companionSha256) {
    throw new Error("Companion changed after the matrix fingerprint lock");
  }
}

async function assertAvdsExist(): Promise<void> {
  const emulator = path.join(await resolveAndroidSdk(), "emulator", "emulator");
  const result = await runCommand(emulator, ["-list-avds"], { cwd: REPO_ROOT });
  const avds = new Set(result.stdout.split("\n").map((line) => line.trim()).filter(Boolean));
  for (const avd of Object.values(ANDROID_E2E_TARGETS)) {
    if (!avds.has(avd)) throw new Error(`Required Android E2E AVD is unavailable: ${avd}`);
  }
}

async function assertNoConnectedAndroidDevices(): Promise<void> {
  const adb = path.join(await resolveAndroidSdk(), "platform-tools", "adb");
  const result = await runCommand(adb, ["devices"], { cwd: REPO_ROOT });
  const connected = result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter((columns) => columns[0] !== "" && columns[1] === "device")
    .map((columns) => columns[0]);
  if (connected.length > 0) {
    throw new Error(
      `Two-device Android E2E requires an isolated emulator slot; connected devices: ${connected.join(", ")}`,
    );
  }
}

async function resolveAndroidSdk(): Promise<string> {
  const configured = process.env.ANDROID_SDK_ROOT?.trim() || process.env.ANDROID_HOME?.trim();
  const candidates = [
    configured,
    path.join(os.homedir(), ".local", "share", "codewide-toolchains", "android-sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate !== "");
  for (const candidate of candidates) {
    try {
      if ((await stat(path.join(candidate, "platform-tools", "adb"))).isFile()) return candidate;
    } catch {
      // Try the next configured Android SDK.
    }
  }
  throw new Error("Android SDK was not found; set ANDROID_SDK_ROOT");
}

async function assertManagedAppServer(): Promise<void> {
  if (process.env.CODEWIDE_LIVE_E2E !== "1") {
    throw new Error("CODEWIDE_LIVE_E2E must be 1 for the real managed App Server matrix");
  }
  const socket =
    process.env.CODEWIDE_E2E_APP_SERVER_SOCKET?.trim() ||
    path.join(process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"), "app-server-control", "app-server-control.sock");
  const metadata = await stat(socket).catch(() => null);
  if (metadata === null || !metadata.isSocket()) {
    throw new Error("Managed App Server socket is unavailable");
  }
}

async function assertMatrixEnvironment(): Promise<void> {
  if (process.env.CODEWIDE_E2E_SERIAL?.trim()) {
    throw new Error("Two-device Android E2E does not accept CODEWIDE_E2E_SERIAL");
  }
  if (process.env.CODEWIDE_E2E_TARGET_FAMILY?.trim()) {
    throw new Error("Two-device Android E2E owns CODEWIDE_E2E_TARGET_FAMILY");
  }
}

function failureEvidence(
  sourceFingerprint: string,
  apkSha256: string,
  companionSha256: string,
  shardRuns: ShardRun[],
  failure: string,
): MergedAndroidE2eEvidence {
  return {
    schemaVersion: 2,
    apkSha256,
    artifacts: [],
    backend: "managedAppServer",
    binaries: { apk: apkArtifact, companion: companionArtifact },
    buildMode: "fresh",
    completedAt: new Date().toISOString(),
    companionSha256,
    contentEquality: [],
    failure,
    parity: null,
    passed: false,
    runId,
    shards: [],
    sourceFingerprint,
    targetFamilies: shardRuns.map((shard) => shard.family),
  };
}

async function writeEvidence(evidence: MergedAndroidE2eEvidence): Promise<void> {
  await writeFile(
    path.join(artifactRoot, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function printResult(evidence: MergedAndroidE2eEvidence): void {
  process.stdout.write(
    `${JSON.stringify({
      artifact: path.relative(REPO_ROOT, path.join(artifactRoot, "evidence.json")),
      failure: evidence.failure,
      passed: evidence.passed,
    })}\n`,
  );
}

async function writeLog(filePath: string, value: string): Promise<void> {
  await writeFile(filePath, value === "" ? "(no output)\n" : value, { mode: 0o600 });
}

function resolveRepoRelative(value: string): string {
  if (value === "" || path.isAbsolute(value)) throw new Error("Invalid shard artifact path");
  const resolved = path.resolve(REPO_ROOT, value);
  if (!resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error("Shard artifact path escapes the repository");
  }
  return resolved;
}

function emptyDigest(): string {
  return `sha256:${"0".repeat(64)}`;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/gu, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
