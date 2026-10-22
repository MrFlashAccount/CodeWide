import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  ANDROID_PREVIEW_VERSION_NAME,
  previewVersionCodeAt,
  updateAndroidReleaseVersion,
  updateAndroidPreviewVersion,
  type AndroidReleaseVersion,
  type ReleaseSourceFiles,
} from "./android-release-lib";

type BuildArguments =
  | {
      readonly channel: "release";
      readonly requestedVersion: string | undefined;
      readonly requestedVersionCode: number | undefined;
    }
  | {
      readonly channel: "preview";
      readonly requestedVersionCode: number | undefined;
    };
type UpdatesConfiguration =
  | { readonly status: "enabled"; readonly endpoint: string }
  | { readonly status: "disabled" };
type ApkSigning = {
  readonly storeFile: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
};
type BuildVariant = {
  readonly channel: "release" | "preview";
  readonly applicationId: string;
  readonly gradleTask: string;
  readonly apkPath: string;
};
type BuildResult = {
  readonly ok: true;
  readonly kind: "apk";
  readonly channel: "release" | "preview";
  readonly applicationId: string;
  readonly previous: AndroidReleaseVersion;
  readonly next: AndroidReleaseVersion;
  readonly updatesEnabled: boolean;
  readonly updateUrl: string | null;
  readonly apkPath: string;
  readonly sha256: string;
  readonly size: number;
  readonly architectures: string;
  readonly artifact: "built-signed-scanned";
};

const repoRoot = resolve(import.meta.dirname, "..");
const appConfigPath = join(repoRoot, "apps/android/app.json");
const gradlePath = join(repoRoot, "apps/android/android/app/build.gradle");
const manifestPath = join(repoRoot, "apps/android/android/app/src/main/AndroidManifest.xml");
const releaseVariant: BuildVariant = {
  channel: "release",
  applicationId: "dev.codexremote.app",
  gradleTask: ":app:assembleRelease",
  apkPath: join(repoRoot, "apps/android/android/app/build/outputs/apk/release/app-release.apk"),
};
const previewVariant: BuildVariant = {
  channel: "preview",
  applicationId: "dev.codexremote.app.preview",
  gradleTask: ":app:assemblePreview",
  apkPath: join(repoRoot, "apps/android/android/app/build/outputs/apk/preview/app-preview.apk"),
};

printResult(await buildRequestedApk(parseArguments(process.argv.slice(2))));

async function buildRequestedApk(args: BuildArguments): Promise<BuildResult> {
  switch (args.channel) {
    case "release":
      return buildReleaseApk(args);
    case "preview":
      return buildPreviewApk(args);
  }
}

/**
 * Builds, signs, verifies and scans the release APK. The requested version is
 * applied to the native sources only for the duration of the Gradle build, so
 * the checkout is left unchanged whether or not the build succeeds.
 */
async function buildReleaseApk(
  args: Extract<BuildArguments, { readonly channel: "release" }>,
): Promise<BuildResult> {
  const updates = resolveUpdatesConfiguration();
  const source = await readReleaseSourceFiles();
  const updated = updateAndroidReleaseVersion(source, args);
  const signing = await resolveApkSigning();
  await validateApkSigning(signing);
  await runReleaseChecks();
  return executeBuild(source, updated, releaseVariant, updates, {
    CODEWIDE_RELEASE_STORE_FILE: signing.storeFile,
    CODEWIDE_RELEASE_STORE_PASSWORD: signing.storePassword,
    CODEWIDE_RELEASE_KEY_ALIAS: signing.keyAlias,
    CODEWIDE_RELEASE_KEY_PASSWORD: signing.keyPassword,
  });
}

async function buildPreviewApk(
  args: Extract<BuildArguments, { readonly channel: "preview" }>,
): Promise<BuildResult> {
  const explicitUpdateUrl = process.env.CODEWIDE_UPDATE_URL?.trim();
  if (explicitUpdateUrl !== undefined && explicitUpdateUrl !== "") {
    throw new Error("Android preview builds do not accept CODEWIDE_UPDATE_URL");
  }
  const source = await readReleaseSourceFiles();
  const versionCode = args.requestedVersionCode ?? previewVersionCodeAt(Date.now());
  const updated = updateAndroidPreviewVersion(source, versionCode);
  const signing = await resolvePreviewSigning();
  await validateApkSigning(signing);
  await runReleaseChecks();
  return executeBuild(
    source,
    updated,
    previewVariant,
    { status: "disabled" },
    {
      CODEWIDE_RELEASE_STORE_FILE: "",
      CODEWIDE_RELEASE_STORE_PASSWORD: "",
      CODEWIDE_RELEASE_KEY_ALIAS: "",
      CODEWIDE_RELEASE_KEY_PASSWORD: "",
      CODEWIDE_PREVIEW_STORE_FILE: signing.storeFile,
      CODEWIDE_PREVIEW_STORE_PASSWORD: signing.storePassword,
      CODEWIDE_PREVIEW_KEY_ALIAS: signing.keyAlias,
      CODEWIDE_PREVIEW_KEY_PASSWORD: signing.keyPassword,
    },
  );
}

async function executeBuild(
  source: ReleaseSourceFiles,
  updated: ReleaseSourceFiles & {
    readonly previous: AndroidReleaseVersion;
    readonly next: AndroidReleaseVersion;
  },
  variant: BuildVariant,
  updates: UpdatesConfiguration,
  buildEnvironment: NodeJS.ProcessEnv,
): Promise<BuildResult> {
  try {
    await writeReleaseSourceFiles(updated);
    await assembleApk(variant, updates, buildEnvironment);
    await verifyApkBuild(variant, updated.next);
    await run("pnpm", ["security:scan-artifacts", "--", variant.apkPath]);
  } finally {
    await writeReleaseSourceFiles(source);
  }
  const apkBytes = await readFile(variant.apkPath);
  return {
    ok: true,
    kind: "apk",
    channel: variant.channel,
    applicationId: variant.applicationId,
    previous: updated.previous,
    next: updated.next,
    updatesEnabled: updates.status === "enabled",
    updateUrl: updates.status === "enabled" ? updates.endpoint : null,
    apkPath: relative(repoRoot, variant.apkPath),
    sha256: createHash("sha256").update(apkBytes).digest("hex"),
    size: apkBytes.byteLength,
    architectures: process.env.CODEWIDE_RELEASE_ARCHITECTURES ?? "arm64-v8a",
    artifact: "built-signed-scanned",
  };
}

async function runReleaseChecks(): Promise<void> {
  await run("pnpm", ["validate:android:v1"]);
  await run("pnpm", ["--filter", "@codewide/android", "compile:android"]);
  await run("pnpm", ["--filter", "@codewide/android", "typecheck"]);
  await run("pnpm", ["--filter", "@codewide/android", "lint"]);
  await run("pnpm", ["test"]);
  await run("pnpm", ["security:scan-secrets"]);
}

async function assembleApk(
  variant: BuildVariant,
  updates: UpdatesConfiguration,
  buildEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
  await run("pnpm", ["android:gradle", "--", variant.gradleTask], {
    ...buildEnvironment,
    CODEWIDE_UPDATE_URL: updates.status === "enabled" ? updates.endpoint : "",
  });
}

async function verifyApkBuild(
  variant: BuildVariant,
  expected: AndroidReleaseVersion,
): Promise<void> {
  await access(variant.apkPath, constants.R_OK);
  const metadataPath = join(dirname(variant.apkPath), "output-metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
    applicationId?: string;
    elements?: Array<{ outputFile?: string; versionName?: string; versionCode?: number }>;
  };
  const artifact = metadata.elements?.find(
    (element) => element.outputFile === basename(variant.apkPath),
  );
  if (
    metadata.applicationId !== variant.applicationId ||
    artifact?.versionName !== expected.versionName ||
    artifact.versionCode !== expected.versionCode
  ) {
    throw new Error(
      `APK metadata mismatch: expected ${variant.applicationId}/${expected.versionName}/${expected.versionCode}, received ` +
        `${metadata.applicationId ?? "missing"}/${artifact?.versionName ?? "missing"}/${artifact?.versionCode ?? "missing"}`,
    );
  }
  const [apksigner, javaHome] = await Promise.all([resolveApkSigner(), resolveJavaHome()]);
  const javaBin = join(javaHome, "bin");
  await run(apksigner, ["verify", "--verbose", "--print-certs", variant.apkPath], {
    JAVA_HOME: javaHome,
    PATH: process.env.PATH === undefined ? javaBin : `${javaBin}${delimiter}${process.env.PATH}`,
  });
}

/**
 * The in-app Expo Updates client stays configurable but inert by default: an
 * APK built without `CODEWIDE_UPDATE_URL` has no update endpoint.
 */
function resolveUpdatesConfiguration(): UpdatesConfiguration {
  const explicit = process.env.CODEWIDE_UPDATE_URL?.trim();
  if (explicit === undefined || explicit === "") return { status: "disabled" };
  return { status: "enabled", endpoint: validateUpdateEndpoint(explicit) };
}

function validateUpdateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/api/updates"))
    throw new Error(`Unsafe Expo Updates endpoint ${value}`);
  return url.toString().replace(/\/$/u, "");
}

async function resolveApkSigning(): Promise<ApkSigning> {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const storeFile = await firstPrivateFile(
    [
      process.env.CODEWIDE_RELEASE_STORE_FILE,
      join(dataRoot, "codewide/signing/release.keystore"),
      join(dataRoot, "codex-remote-signing/release.keystore"),
    ],
    "Android release keystore",
  );
  const passwordFile = await firstPrivateFile(
    [process.env.CODEWIDE_RELEASE_PASSWORD_FILE, join(dirname(storeFile), "release.password")],
    "Android release password file",
  );
  const filePassword = (await readFile(passwordFile, "utf8")).trim();
  const storePassword = process.env.CODEWIDE_RELEASE_STORE_PASSWORD ?? filePassword;
  const keyPassword = process.env.CODEWIDE_RELEASE_KEY_PASSWORD ?? filePassword;
  const keyAlias = process.env.CODEWIDE_RELEASE_KEY_ALIAS ?? "codex-remote-v1";
  if (storePassword === "" || keyPassword === "" || keyAlias === "")
    throw new Error("Android release signing credentials are empty");
  return { storeFile, storePassword, keyAlias, keyPassword };
}

async function resolvePreviewSigning(): Promise<ApkSigning> {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const storeFile = resolve(
    process.env.CODEWIDE_PREVIEW_STORE_FILE ?? join(dataRoot, "codewide/signing/preview.keystore"),
  );
  const existing = await stat(storeFile).catch(() => null);
  if (existing !== null && !existing.isFile()) {
    throw new Error(`Android preview keystore path is not a file: ${storeFile}`);
  }
  const signing = {
    storeFile,
    storePassword: "android",
    keyAlias: "codewide-preview",
    keyPassword: "android",
  };
  if (existing === null) {
    await mkdir(dirname(storeFile), { recursive: true, mode: 0o700 });
    const keytool = join(await resolveJavaHome(), "bin/keytool");
    await run(
      keytool,
      [
        "-genkeypair",
        "-keystore",
        storeFile,
        "-storepass",
        signing.storePassword,
        "-alias",
        signing.keyAlias,
        "-keypass",
        signing.keyPassword,
        "-dname",
        "CN=CodeWide Preview,OU=Development,O=CodeWide",
        "-keyalg",
        "RSA",
        "-keysize",
        "2048",
        "-validity",
        "10000",
      ],
      {},
      false,
    );
    await chmod(storeFile, 0o600);
  }
  return signing;
}

async function validateApkSigning(signing: ApkSigning): Promise<void> {
  const keytool = join(await resolveJavaHome(), "bin/keytool");
  await run(
    keytool,
    [
      "-list",
      "-keystore",
      signing.storeFile,
      "-storepass",
      signing.storePassword,
      "-alias",
      signing.keyAlias,
    ],
    {},
    false,
  );
}

async function resolveJavaHome(): Promise<string> {
  const javaHomes = [
    process.env.JAVA_HOME,
    join(homedir(), ".gradle/jdks/eclipse_adoptium-17-amd64-linux.2"),
    join(homedir(), "android-studio/jbr"),
    "/opt/android-studio/jbr",
  ];
  for (const javaHome of javaHomes) {
    if (javaHome === undefined || javaHome.trim() === "") continue;
    if (
      (await isExecutable(join(javaHome, "bin/java"))) &&
      (await isExecutable(join(javaHome, "bin/keytool")))
    )
      return javaHome;
  }
  throw new Error(
    "Android release JDK was not found in JAVA_HOME or the standard CodeWide JDK directories",
  );
}

async function resolveApkSigner(): Promise<string> {
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), ".local/share/codewide-toolchains/android-sdk"),
    join(homedir(), "Android/Sdk"),
  ];
  for (const sdk of sdkCandidates) {
    if (sdk === undefined) continue;
    const buildTools = join(sdk, "build-tools");
    const versions = await readdir(buildTools).catch(() => []);
    for (const version of versions.sort().reverse()) {
      const candidate = join(buildTools, version, "apksigner");
      if (await isExecutable(candidate)) return candidate;
    }
  }
  throw new Error("Android apksigner was not found");
}

async function firstPrivateFile(
  candidates: ReadonlyArray<string | undefined>,
  label: string,
): Promise<string> {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.trim() === "") continue;
    const path = resolve(candidate);
    const metadata = await stat(path).catch(() => null);
    if (metadata?.isFile() !== true) continue;
    if ((metadata.mode & 0o077) !== 0)
      throw new Error(`${label} must not be group/world accessible: ${path}`);
    return path;
  }
  throw new Error(
    `${label} was not found in the environment or standard CodeWide data directories`,
  );
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

async function readReleaseSourceFiles(): Promise<ReleaseSourceFiles> {
  const [appConfig, gradle, manifest] = await Promise.all([
    readFile(appConfigPath, "utf8"),
    readFile(gradlePath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  return { appConfig, gradle, manifest };
}

async function writeReleaseSourceFiles(files: ReleaseSourceFiles): Promise<void> {
  await Promise.all([
    atomicWrite(appConfigPath, files.appConfig),
    atomicWrite(gradlePath, files.gradle),
    atomicWrite(manifestPath, files.manifest),
  ]);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.release-${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: (await stat(path)).mode & 0o777 });
  await rename(temporary, path);
}

async function run(
  command: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {},
  showOutput = true,
): Promise<void> {
  process.stderr.write(`\n[android-apk] ${command} ${redactedArguments(args).join(" ")}\n`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: showOutput ? "inherit" : ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    if (!showOutput && child.stderr !== null)
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(
            `${command} failed (${signal ?? `exit ${code ?? "unknown"}`})${stderr === "" ? "" : `: ${stderr.trim()}`}`,
          ),
        );
    });
  });
}

function redactedArguments(args: readonly string[]): string[] {
  return args.map((argument, index) =>
    args[index - 1] === "-storepass" || args[index - 1] === "-keypass" ? "<redacted>" : argument,
  );
}

function parseArguments(args: readonly string[]): BuildArguments {
  let preview = false;
  let requestedVersion: string | undefined;
  let requestedVersionCode: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--preview") {
      preview = true;
    } else if (argument === "--version") {
      requestedVersion = args[index + 1];
      if (requestedVersion === undefined) throw new Error("--version requires X.Y.Z");
      index += 1;
    } else if (argument === "--version-code") {
      const raw = args[index + 1];
      if (raw === undefined || !/^\d+$/u.test(raw))
        throw new Error("--version-code requires a positive integer");
      requestedVersionCode = Number(raw);
      if (!Number.isSafeInteger(requestedVersionCode) || requestedVersionCode <= 0) {
        throw new Error("--version-code requires a positive safe integer");
      }
      index += 1;
    } else {
      throw new Error(
        `Unknown argument ${argument ?? ""}. Usage: build-android-apk [--preview] [--version X.Y.Z] [--version-code N]`,
      );
    }
  }
  if (preview) {
    if (requestedVersion !== undefined) {
      throw new Error(
        `Android preview versionName is fixed at ${ANDROID_PREVIEW_VERSION_NAME}; omit --version`,
      );
    }
    return { channel: "preview", requestedVersionCode };
  }
  return { channel: "release", requestedVersion, requestedVersionCode };
}

function printResult(result: BuildResult): void {
  process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
}
