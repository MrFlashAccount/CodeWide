import type { AndroidDevice } from "./androidDevice.ts";
import { adb } from "./androidDevice.ts";
import { delay } from "./process.ts";
import type { AppiumBrowser } from "./ui.ts";

export type BootParityGeneration = "v1" | "v2";
export type BootParityLayout = "phone" | "wide";

export type CaptureBootParityRow = (
  driver: AppiumBrowser,
  generation: BootParityGeneration,
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

export type BootParityInput = {
  activityName: string;
  captureRow: CaptureBootParityRow;
  device: AndroidDevice;
  driver: AppiumBrowser;
  generation: BootParityGeneration;
  layout: BootParityLayout;
  packageName: string;
  repoRoot: string;
  restoreReady(): Promise<void>;
  timeoutMs: number;
};

const SECURE_STORE_PREFERENCES = "shared_prefs/SecureStore.xml";
const SECURE_STORE_BACKUP = "files/codewide-e2e-boot-SecureStore.xml";
const UI_GENERATION_KEY = "key_v1-codewide.ui-generation";
const COLD_STATE_DELAYS_MS = [0, 16, 32, 48, 64, 96, 128, 180, 250, 350, 500, 750, 1_000];

/** Captures real cold-start surfaces from the installed E2E APK and its persisted generation. */
export async function captureBootParityStates(input: BootParityInput): Promise<void> {
  let failure: Error | null = null;
  try {
    await captureNativeSplash(input);
    await captureFontBootstrap(input);
    await captureInitialProjectionLoading(input);
    await captureFatalStartup(input);
  } catch (cause) {
    failure = cause instanceof Error ? cause : new Error(String(cause));
  }

  let restoreFailure: Error | null = null;
  try {
    await resumeApplicationProcess(input);
    await input.driver.terminateApp(input.packageName);
    await input.restoreReady();
  } catch (cause) {
    restoreFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (failure !== null && restoreFailure !== null) {
    throw new Error(
      `Boot parity failed: ${failure.message}; restoration failed: ${restoreFailure.message}`,
      { cause: new AggregateError([failure, restoreFailure]) },
    );
  }
  if (restoreFailure !== null) throw restoreFailure;
  if (failure !== null) throw failure;
}

async function captureNativeSplash(input: BootParityInput): Promise<void> {
  await captureColdState(input, "BOOT-01", `${input.layout}-native-cold-launch`, async (source) => {
    const [currentPackage, windows] = await Promise.all([
      input.driver.getCurrentPackage(),
      adb(input.device, input.repoRoot, ["shell", "dumpsys", "window", "windows"]),
    ]);
    if (currentPackage !== input.packageName) {
      throw new Error(`Native splash belongs to ${currentPackage}, not ${input.packageName}`);
    }
    const escapedPackage = input.packageName.replaceAll(".", "\\.");
    const focusedSplash = new RegExp(
      `mCurrentFocus=.*Splash Screen ${escapedPackage}(?:\\s|})`,
      "u",
    );
    if (!focusedSplash.test(windows)) {
      throw new Error("Android native splash starting window is not active");
    }
    if (source.includes("root-boot-state") || source.includes("root-suspense-state")) {
      throw new Error("React Native boot content replaced the native splash");
    }
    assertNoApplicationShell(source);
  });
}

async function captureFontBootstrap(input: BootParityInput): Promise<void> {
  await captureColdState(input, "BOOT-02", `${input.layout}-font-bootstrap`, async (source) => {
    if (!source.includes("root-boot-state") || !source.includes('text="CodeWide"')) {
      throw new Error("The real font-bootstrap surface is not active");
    }
    assertNoApplicationShell(source);
  });
}

async function captureInitialProjectionLoading(input: BootParityInput): Promise<void> {
  const expectedMarkers =
    input.generation === "v1"
      ? ["Loading chats", "Preparing local storage"]
      : ["Starting CodeWide V2", "Loading saved servers", "Loading threads"];
  await captureColdState(
    input,
    "BOOT-03",
    `${input.layout}-initial-local-projection-loading`,
    async (source) => {
      if (!expectedMarkers.some((marker) => source.includes(marker))) {
        throw new Error(
          `Initial ${input.generation} projection loading is not active (${expectedMarkers.join(" | ")})`,
        );
      }
    },
  );
}

async function captureFatalStartup(input: BootParityInput): Promise<void> {
  await backupAndCorruptUiGeneration(input);
  let captureFailure: Error | null = null;
  try {
    await coldLaunch(input);
    const error = await input.driver.$("~Retry interface loading");
    await error.waitForDisplayed({ timeout: input.timeoutMs, interval: 50 });
    await input.captureRow(
      input.driver,
      input.generation,
      "BOOT-06",
      `${input.layout}-fatal-startup-error`,
      async () => {
        const source = await input.driver.getPageSource();
        if (
          !source.includes("Could not read UI generation") ||
          !source.includes('content-desc="Retry interface loading"')
        ) {
          throw new Error("Corrupted durable startup input did not reach the fatal retry surface");
        }
        assertNoApplicationShell(source);
      },
    );
  } catch (cause) {
    captureFailure = cause instanceof Error ? cause : new Error(String(cause));
  }

  let restoreFailure: Error | null = null;
  try {
    await input.driver.terminateApp(input.packageName);
    await restoreSecureStore(input);
  } catch (cause) {
    restoreFailure = cause instanceof Error ? cause : new Error(String(cause));
  }
  if (captureFailure !== null && restoreFailure !== null) {
    throw new Error(
      `Fatal-startup capture failed: ${captureFailure.message}; SecureStore restoration failed: ${restoreFailure.message}`,
      { cause: new AggregateError([captureFailure, restoreFailure]) },
    );
  }
  if (restoreFailure !== null) throw restoreFailure;
  if (captureFailure !== null) throw captureFailure;
}

async function captureColdState(
  input: BootParityInput,
  rowId: "BOOT-01" | "BOOT-02" | "BOOT-03",
  state: string,
  assertObservedState: (source: string) => Promise<void>,
): Promise<void> {
  const failures: string[] = [];
  for (const delayMs of COLD_STATE_DELAYS_MS) {
    const probe = await stopColdLaunchAt(input, delayMs);
    try {
      const source = await input.driver.getPageSource();
      await assertObservedState(source);
      await input.captureRow(input.driver, input.generation, rowId, state, async () => {
        const frozenSource = await input.driver.getPageSource();
        await assertObservedState(frozenSource);
      });
      return;
    } catch (cause) {
      failures.push(
        `${probe.delayMs}ms: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      await resumeApplicationProcess(input);
      await input.driver.terminateApp(input.packageName).catch(() => undefined);
    }
  }
  throw new Error(
    `${rowId} never exposed its real installed-app state after cold launch: ${failures.join("; ")}`,
  );
}

async function stopColdLaunchAt(
  input: BootParityInput,
  delayMs: number,
): Promise<{ delayMs: number }> {
  await coldLaunch(input);
  if (delayMs > 0) await delay(delayMs);
  const processId = await waitForApplicationProcess(input);
  await runAs(input, `kill -STOP ${processId}`);
  return { delayMs };
}

async function coldLaunch(input: BootParityInput): Promise<void> {
  await resumeApplicationProcess(input);
  await input.driver.terminateApp(input.packageName).catch(() => undefined);
  await adb(input.device, input.repoRoot, [
    "shell",
    "am",
    "start",
    "-n",
    `${input.packageName}/${input.activityName}`,
  ]);
}

async function waitForApplicationProcess(input: BootParityInput): Promise<string> {
  const deadline = Date.now() + Math.min(input.timeoutMs, 10_000);
  while (Date.now() < deadline) {
    const processId = (
      await adb(input.device, input.repoRoot, ["shell", "pidof", input.packageName], {
        allowFailure: true,
      })
    ).trim();
    if (/^\d+$/u.test(processId)) return processId;
    await delay(10);
  }
  throw new Error(`Cold launch did not create ${input.packageName}`);
}

async function resumeApplicationProcess(input: BootParityInput): Promise<void> {
  const processId = (
    await adb(input.device, input.repoRoot, ["shell", "pidof", input.packageName], {
      allowFailure: true,
    })
  ).trim();
  if (/^\d+$/u.test(processId)) {
    await runAs(input, `kill -CONT ${processId}`, true);
  }
}

async function backupAndCorruptUiGeneration(input: BootParityInput): Promise<void> {
  const replace = `sed -i 's#<string name="${UI_GENERATION_KEY}">.*</string>#<string name="${UI_GENERATION_KEY}">not-json</string>#' ${SECURE_STORE_PREFERENCES}`;
  const insert = `sed -i 's#</map>#    <string name="${UI_GENERATION_KEY}">not-json</string>\\n</map>#' ${SECURE_STORE_PREFERENCES}`;
  const script =
    `test -f ${SECURE_STORE_PREFERENCES} && ` +
    `cp ${SECURE_STORE_PREFERENCES} ${SECURE_STORE_BACKUP} && ` +
    `if grep -q '${UI_GENERATION_KEY}' ${SECURE_STORE_PREFERENCES}; ` +
    `then ${replace}; else ${insert}; fi`;
  await input.driver.terminateApp(input.packageName).catch(() => undefined);
  await runAs(input, script);
}

async function restoreSecureStore(input: BootParityInput): Promise<void> {
  await runAs(
    input,
    `cp ${SECURE_STORE_BACKUP} ${SECURE_STORE_PREFERENCES} && rm ${SECURE_STORE_BACKUP}`,
  );
}

async function runAs(input: BootParityInput, script: string, allowFailure = false): Promise<void> {
  await adb(
    input.device,
    input.repoRoot,
    ["shell", "run-as", input.packageName, "sh", "-c", quoteAndroidShellArgument(script)],
    { allowFailure },
  );
}

function assertNoApplicationShell(source: string): void {
  for (const marker of [
    "New thread",
    "Choose server",
    "Message Codex",
    "Open manual server setup",
  ]) {
    if (source.includes(marker)) {
      throw new Error(`Application shell ${marker} rendered over the boot surface`);
    }
  }
}

function quoteAndroidShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
