import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { delay, ManagedProcess, runCommand } from "./process.ts";

const BOOT_TIMEOUT_MS = 180_000;

export type AndroidDevice = {
  adbPath: string;
  emulatorProcess: ManagedProcess | null;
  sdkRoot: string;
  serial: string;
};

export async function acquireAndroidDevice(repoRoot: string, artifactDir: string): Promise<AndroidDevice> {
  const sdkRoot = await resolveAndroidSdk();
  const adbPath = path.join(sdkRoot, "platform-tools", "adb");
  const emulatorPath = path.join(sdkRoot, "emulator", "emulator");
  await access(adbPath);
  await runCommand(adbPath, ["start-server"], { cwd: repoRoot });

  const requestedSerial = process.env.CODEWIDE_E2E_SERIAL?.trim();
  let serial = await selectRunningEmulator(adbPath, repoRoot, requestedSerial);
  let emulatorProcess: ManagedProcess | null = null;
  if (serial === null) {
    await access(emulatorPath);
    const avd = process.env.CODEWIDE_E2E_AVD?.trim() || await firstAvd(emulatorPath, repoRoot);
    emulatorProcess = new ManagedProcess(emulatorPath, [
      "-avd", avd,
      "-no-window",
      "-no-boot-anim",
      "-no-snapshot-save",
      "-gpu", "swiftshader_indirect",
    ], {
      cwd: repoRoot,
      logPath: path.join(artifactDir, "emulator.log"),
    });
    serial = await waitForNewEmulator(adbPath, repoRoot, emulatorProcess);
  }
  await waitForBoot(adbPath, repoRoot, serial);
  return { adbPath, emulatorProcess, sdkRoot, serial };
}

export async function adb(
  device: AndroidDevice,
  repoRoot: string,
  args: string[],
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const result = await runCommand(device.adbPath, ["-s", device.serial, ...args], {
    cwd: repoRoot,
    ...(options.allowFailure === undefined ? {} : { allowFailure: options.allowFailure }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return result.stdout;
}

export async function installFreshApp(
  device: AndroidDevice,
  repoRoot: string,
  apkPath: string,
  packageName: string,
): Promise<void> {
  await adb(device, repoRoot, ["install", "-r", "-t", apkPath], { timeoutMs: 180_000 });
  await adb(device, repoRoot, ["shell", "pm", "clear", packageName]);
  // The E2E runner installs and clears the APK before Appium opens the session,
  // so Appium's autoGrantPermissions capability does not reliably cover runtime
  // permissions for this preinstalled package.
  await adb(device, repoRoot, ["shell", "pm", "grant", packageName, "android.permission.RECORD_AUDIO"], { allowFailure: true });
  await adb(device, repoRoot, ["shell", "pm", "grant", packageName, "android.permission.POST_NOTIFICATIONS"], { allowFailure: true });
}

export async function openDeepLink(
  device: AndroidDevice,
  repoRoot: string,
  packageName: string,
  url: string,
): Promise<void> {
  await adb(device, repoRoot, [
    "shell", "am", "start", "-W",
    "-a", "android.intent.action.VIEW",
    "-d", quoteAndroidShellArgument(url),
    "-p", quoteAndroidShellArgument(packageName),
  ], { timeoutMs: 60_000 });
}

function quoteAndroidShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function reversePort(device: AndroidDevice, repoRoot: string, port: number): Promise<void> {
  await adb(device, repoRoot, ["reverse", `tcp:${port}`, `tcp:${port}`]);
}

export async function removeReversePort(device: AndroidDevice, repoRoot: string, port: number): Promise<void> {
  await adb(device, repoRoot, ["reverse", "--remove", `tcp:${port}`], { allowFailure: true });
}

export async function captureLogcat(device: AndroidDevice, repoRoot: string): Promise<string> {
  return adb(device, repoRoot, ["logcat", "-d", "-v", "threadtime"], { allowFailure: true, timeoutMs: 60_000 });
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
      await access(path.join(candidate, "platform-tools", "adb"));
      return candidate;
    } catch {
      // Try the next configured SDK location.
    }
  }
  throw new Error("Android SDK was not found; set ANDROID_SDK_ROOT");
}

async function selectRunningEmulator(adbPath: string, repoRoot: string, requestedSerial: string | undefined): Promise<string | null> {
  const result = await runCommand(adbPath, ["devices"], { cwd: repoRoot });
  const serials = result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[0]?.startsWith("emulator-") && columns[1] === "device")
    .map((columns) => columns[0])
    .filter((serial): serial is string => serial !== undefined);
  if (requestedSerial !== undefined) {
    if (!serials.includes(requestedSerial)) throw new Error(`Requested Android emulator is not connected: ${requestedSerial}`);
    return requestedSerial;
  }
  if (serials.length > 1) throw new Error("Multiple Android emulators are connected; set CODEWIDE_E2E_SERIAL");
  return serials[0] ?? null;
}

async function firstAvd(emulatorPath: string, repoRoot: string): Promise<string> {
  const result = await runCommand(emulatorPath, ["-list-avds"], { cwd: repoRoot });
  const avd = result.stdout.split("\n").map((line) => line.trim()).find((line) => line !== "");
  if (avd === undefined) throw new Error("No Android virtual device is configured");
  return avd;
}

async function waitForNewEmulator(
  adbPath: string,
  repoRoot: string,
  process: ManagedProcess,
): Promise<string> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Android emulator exited during startup: ${process.tail}`);
    const serial = await selectRunningEmulator(adbPath, repoRoot, undefined);
    if (serial !== null) return serial;
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for Android emulator: ${process.tail}`);
}

async function waitForBoot(adbPath: string, repoRoot: string, serial: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await runCommand(adbPath, ["-s", serial, "shell", "getprop", "sys.boot_completed"], {
      cwd: repoRoot,
      allowFailure: true,
      timeoutMs: 10_000,
    });
    if (result.stdout.trim() === "1") return;
    await delay(1_000);
  }
  throw new Error(`Android emulator did not finish booting: ${serial}`);
}
