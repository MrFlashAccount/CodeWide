import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { get as httpGet } from "node:http";

import {
  deriveUpdateEndpoint,
  readAndroidReleaseVersion,
  updateAndroidReleaseVersion,
  type AndroidReleaseVersion,
  type AndroidReleaseVersionBaseline,
} from "./android-release-lib";

type ReleaseMode = "ota" | "apk";
type UpdatesConfiguration =
  | { readonly status: "enabled"; readonly endpoint: string }
  | { readonly status: "disabled" };
type JsonObject = Record<string, unknown>;
type BuildShelfArtifact = {
  id: string;
  versionName: string;
  versionCode: number | null;
  sha256: string;
  size: number;
  downloadUrl: string;
  latest: boolean;
};

const repoRoot = resolve(import.meta.dirname, "..");
const appConfigPath = join(repoRoot, "apps/android/app.json");
const gradlePath = join(repoRoot, "apps/android/android/app/build.gradle");
const manifestPath = join(repoRoot, "apps/android/android/app/src/main/AndroidManifest.xml");
const certificatePath = join(repoRoot, "apps/android/certs/certificate.pem");
const otaRoot = join(repoRoot, "builds/ota");
const apkArchiveRoot = join(repoRoot, "builds/android");
const apkPath = join(repoRoot, "apps/android/android/app/build/outputs/apk/release/app-release.apk");
const apkMetadataPath = join(dirname(apkPath), "output-metadata.json");
const lockPath = join(repoRoot, "builds/.android-release.lock");
const localShelfUrl = "http://127.0.0.1:4190";

const { mode, dryRun, requestedVersion, requestedVersionCode } = parseArguments(process.argv.slice(2));
const lock = await acquireLock();
try {
  const updates = await resolveUpdatesConfiguration();
  if (mode === "ota") {
    const endpoint = requireUpdateEndpoint(updates, "OTA publication");
    if (!dryRun) await requireHealthyShelf(endpoint);
    await releaseOta(endpoint, dryRun);
  } else {
    if (!dryRun) await requireHealthyShelf(requireUpdateEndpoint(updates, "local APK publication"));
    await releaseApk(updates, dryRun, requestedVersion, requestedVersionCode);
  }
} finally {
  await lock.close();
  await rm(lockPath, { force: true });
}

async function releaseOta(endpoint: string, dryRun: boolean): Promise<void> {
  const version = await readCurrentVersion();
  const privateKeyPath = await resolvePrivateKey();
  await validateOtaSigningKey(privateKeyPath);
  await runReleaseChecks();
  if (dryRun) {
    await run("pnpm", ["ota:publish:raw", "--", "--dry-run"], {
      CODEWIDE_UPDATE_URL: endpoint,
      CODEWIDE_OTA_PRIVATE_KEY: privateKeyPath,
    });
    printResult({
      ok: true,
      dryRun: true,
      kind: "ota",
      runtimeVersion: version.runtimeVersion,
      updateUrl: endpoint,
      artifact: "built-signed-scanned",
    });
    return;
  }

  const before = new Set(await otaReleaseDirectories(version.runtimeVersion));
  await run("pnpm", ["ota:publish:raw"], {
    CODEWIDE_UPDATE_URL: endpoint,
    CODEWIDE_OTA_PRIVATE_KEY: privateKeyPath,
  });
  const created = (await otaReleaseDirectories(version.runtimeVersion)).filter((directory) => !before.has(directory));
  if (created.length !== 1) throw new Error(`Expected one OTA release, found ${created.length}`);
  const releaseDirectory = created[0];
  if (releaseDirectory === undefined) throw new Error("OTA release directory was not created");

  try {
    const release = JSON.parse(await readFile(join(releaseDirectory, "release.json"), "utf8")) as {
      updateId: string;
      runtimeVersion: string;
      createdAt: string;
    };
    const manifest = JSON.parse(await readFile(join(releaseDirectory, "manifest.json"), "utf8")) as {
      launchAsset: { hash: string; url: string };
    };
    await run("pnpm", ["security:scan-artifacts", "--", releaseDirectory]);
    await verifyPublicOta(endpoint, release.updateId, release.runtimeVersion, manifest.launchAsset);
    printResult({
      ok: true,
      kind: "ota",
      updateId: release.updateId,
      runtimeVersion: release.runtimeVersion,
      createdAt: release.createdAt,
      updateUrl: endpoint,
      directory: relativeToRepo(releaseDirectory),
    });
  } catch (error) {
    await rm(releaseDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function releaseApk(
  updates: UpdatesConfiguration,
  dryRun: boolean,
  requestedVersion?: string,
  requestedVersionCode?: number,
): Promise<void> {
  const source = await readReleaseSourceFiles();
  const publishedBaseline = dryRun
    ? undefined
    : await findLatestPublishedApkVersion(requireUpdateEndpoint(updates, "local APK publication"));
  const updated = updateAndroidReleaseVersion(source, {
    requestedVersion,
    requestedVersionCode,
    published: publishedBaseline,
  });
  const signing = await resolveApkSigning();
  await validateApkSigning(signing);
  await runReleaseChecks();
  let sourceUpdated = false;
  let published = false;
  try {
    sourceUpdated = true;
    await writeReleaseSourceFiles(updated);
    await run("pnpm", ["android:gradle", "--", ":app:assembleRelease"], {
      CODEWIDE_UPDATE_URL: updates.status === "enabled" ? updates.endpoint : "",
      CODEWIDE_RELEASE_STORE_FILE: signing.storeFile,
      CODEWIDE_RELEASE_STORE_PASSWORD: signing.storePassword,
      CODEWIDE_RELEASE_KEY_ALIAS: signing.keyAlias,
      CODEWIDE_RELEASE_KEY_PASSWORD: signing.keyPassword,
    });
    await verifyApkBuild(updated.next);
    await run("pnpm", ["security:scan-artifacts", "--", apkPath]);
    const apkBytes = await readFile(apkPath);
    const sha256 = createHash("sha256").update(apkBytes).digest("hex");
    if (dryRun) {
      await writeReleaseSourceFiles(source);
      sourceUpdated = false;
      printResult({
        ok: true,
        dryRun: true,
        kind: "apk",
        previous: updated.previous,
        next: updated.next,
        updatesEnabled: updates.status === "enabled",
        updateUrl: updates.status === "enabled" ? updates.endpoint : null,
        sha256,
        size: apkBytes.byteLength,
        architectures: process.env.CODEWIDE_RELEASE_ARCHITECTURES ?? "arm64-v8a",
        artifact: "built-signed-scanned",
      });
      return;
    }
    await archiveReleaseApk(updated.next, sha256);
    published = true;
    const endpoint = requireUpdateEndpoint(updates, "local APK publication");
    const artifact = await findPublishedArtifact(endpoint, sha256, updated.next);
    const publicOrigin = new URL(endpoint).origin;
    const downloadUrl = new URL(artifact.downloadUrl, publicOrigin).toString();
    const downloaded = Buffer.from(await expectOk(await fetch(downloadUrl), "public APK download").arrayBuffer());
    const downloadedHash = createHash("sha256").update(downloaded).digest("hex");
    if (downloadedHash !== sha256) throw new Error(`Public APK hash mismatch: expected ${sha256}, received ${downloadedHash}`);
    printResult({
      ok: true,
      kind: "apk",
      versionName: updated.next.versionName,
      versionCode: updated.next.versionCode,
      runtimeVersion: updated.next.runtimeVersion,
      artifactId: artifact.id,
      sha256,
      size: apkBytes.byteLength,
      architectures: process.env.CODEWIDE_RELEASE_ARCHITECTURES ?? "arm64-v8a",
      downloadUrl,
      latestUrl: new URL("/latest.apk", publicOrigin).toString(),
    });
  } catch (error) {
    if (sourceUpdated && !published) await writeReleaseSourceFiles(source);
    throw error;
  }
}

async function runReleaseChecks(): Promise<void> {
  await run("pnpm", ["validate:android:v1"]);
  await run("pnpm", ["--filter", "@codewide/android", "typecheck"]);
  await run("pnpm", ["--filter", "@codewide/android", "lint"]);
  await run("pnpm", ["test"]);
  await run("pnpm", ["test:ota"]);
  await run("pnpm", ["security:scan-secrets"]);
}

async function verifyPublicOta(
  endpoint: string,
  updateId: string,
  runtimeVersion: string,
  launchAsset: { hash: string; url: string },
): Promise<void> {
  const baseHeaders = {
    "expo-protocol-version": "1",
    "expo-platform": "android",
    "expo-runtime-version": runtimeVersion,
    "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
  };
  const manifestResponse = expectOk(await fetch(endpoint, {
    headers: { ...baseHeaders, "expo-current-update-id": "embedded" },
  }), "public OTA manifest");
  const manifestBody = Buffer.from(await manifestResponse.arrayBuffer()).toString("utf8");
  if (!manifestBody.includes(updateId)) throw new Error(`Public OTA endpoint did not return update ${updateId}`);
  const launchBytes = Buffer.from(await expectOk(await fetch(launchAsset.url), "public OTA launch asset").arrayBuffer());
  const launchHash = createHash("sha256").update(launchBytes).digest("base64url");
  if (launchHash !== launchAsset.hash) throw new Error(`Public OTA asset hash mismatch: expected ${launchAsset.hash}, received ${launchHash}`);
  const currentResponse = expectOk(await fetch(endpoint, {
    headers: { ...baseHeaders, "expo-current-update-id": updateId },
  }), "public OTA no-update directive");
  const currentBody = Buffer.from(await currentResponse.arrayBuffer()).toString("utf8");
  if (!currentBody.includes("noUpdateAvailable")) throw new Error("Public OTA endpoint did not return noUpdateAvailable for the new update");
}

async function verifyApkBuild(expected: AndroidReleaseVersion): Promise<void> {
  await access(apkPath, constants.R_OK);
  const metadata = JSON.parse(await readFile(apkMetadataPath, "utf8")) as {
    elements?: Array<{ outputFile?: string; versionName?: string; versionCode?: number }>;
  };
  const release = metadata.elements?.find((element) => element.outputFile === basename(apkPath));
  if (release?.versionName !== expected.versionName || release.versionCode !== expected.versionCode) {
    throw new Error(`APK metadata mismatch: expected ${expected.versionName}/${expected.versionCode}, received ${release?.versionName ?? "missing"}/${release?.versionCode ?? "missing"}`);
  }
  const [apksigner, javaHome] = await Promise.all([resolveApkSigner(), resolveJavaHome()]);
  const javaBin = join(javaHome, "bin");
  await run(apksigner, ["verify", "--verbose", "--print-certs", apkPath], {
    JAVA_HOME: javaHome,
    PATH: process.env.PATH === undefined ? javaBin : `${javaBin}${delimiter}${process.env.PATH}`,
  });
}

async function archiveReleaseApk(version: AndroidReleaseVersion, sha256: string): Promise<string> {
  await mkdir(apkArchiveRoot, { recursive: true, mode: 0o700 });
  const timestamp = compactUtcTimestamp(new Date());
  const name = `CodeWide-${version.versionName}-${version.versionCode}-${timestamp}-${sha256.slice(0, 8)}.apk`;
  const destination = join(apkArchiveRoot, name);
  const partial = `${destination}.partial`;
  const sidecar = `${destination}.json`;
  try {
    await copyFile(apkPath, partial);
    await chmod(partial, 0o600);
    await rename(partial, destination);
    await atomicNewFile(sidecar, `${JSON.stringify({
      variant: "release",
      versionName: version.versionName,
      versionCode: version.versionCode,
      sha256,
    }, null, 2)}\n`);
  } catch (error) {
    await Promise.all([rm(partial, { force: true }), rm(destination, { force: true }), rm(sidecar, { force: true })]);
    throw error;
  }
  await pruneApkArchive(8);
  await requestLocalShelf("/api/builds", "local build shelf publication");
  return destination;
}

async function pruneApkArchive(retain: number): Promise<void> {
  const entries = await readdir(apkArchiveRoot, { withFileTypes: true });
  const apks = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".apk"))
    .map(async (entry) => {
      const path = join(apkArchiveRoot, entry.name);
      return { path, mtime: (await stat(path)).mtimeMs };
    }));
  const stale = apks.sort((left, right) => right.mtime - left.mtime).slice(retain);
  for (const { path } of stale) {
    await rm(path, { force: true });
    await rm(`${path}.json`, { force: true });
  }
}

async function findPublishedArtifact(endpoint: string, sha256: string, expected: AndroidReleaseVersion): Promise<BuildShelfArtifact> {
  const publicOrigin = new URL(endpoint).origin;
  const catalog = await fetchBuildShelfCatalog(publicOrigin);
  const artifact = catalog.find((build) => build.sha256 === sha256);
  if (artifact === undefined) throw new Error(`Public build catalog did not contain APK ${sha256.slice(0, 12)}`);
  if (artifact.versionName !== expected.versionName || artifact.versionCode !== expected.versionCode || !artifact.latest) {
    throw new Error(`Published APK is not latest ${expected.versionName}/${expected.versionCode}`);
  }
  return artifact;
}

async function findLatestPublishedApkVersion(endpoint: string): Promise<AndroidReleaseVersionBaseline | undefined> {
  const catalog = await fetchBuildShelfCatalog(new URL(endpoint).origin);
  const latest = catalog.filter((artifact) => artifact.latest);
  if (latest.length > 1) throw new Error(`Public build catalog contains ${latest.length} latest APKs`);
  const artifact = latest[0];
  if (artifact === undefined) return undefined;
  if (artifact.versionCode === null) throw new Error("Latest public APK has no version code");
  if (!/^\d+\.\d+\.\d+$/u.test(artifact.versionName)) {
    throw new Error(`Latest public APK has invalid release version ${artifact.versionName}`);
  }
  return { versionName: artifact.versionName, versionCode: artifact.versionCode };
}

async function fetchBuildShelfCatalog(publicOrigin: string): Promise<BuildShelfArtifact[]> {
  const response = expectOk(
    await fetch(new URL("/api/builds", publicOrigin), { cache: "no-store" }),
    "public build catalog",
  );
  return parseBuildShelfCatalog(await response.json());
}

function parseBuildShelfCatalog(value: unknown): BuildShelfArtifact[] {
  if (!isJsonObject(value) || !Array.isArray(value.builds)) {
    throw new Error("Public build catalog has an invalid response shape");
  }
  return value.builds.map(parseBuildShelfArtifact);
}

function parseBuildShelfArtifact(value: unknown): BuildShelfArtifact {
  if (
    !isJsonObject(value)
    || typeof value.id !== "string"
    || typeof value.versionName !== "string"
    || !(
      value.versionCode === null
      || (typeof value.versionCode === "number" && Number.isInteger(value.versionCode))
    )
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || typeof value.size !== "number"
    || !Number.isInteger(value.size)
    || typeof value.downloadUrl !== "string"
    || typeof value.latest !== "boolean"
  ) {
    throw new Error("Public build catalog contains an invalid APK record");
  }
  return {
    id: value.id,
    versionName: value.versionName,
    versionCode: value.versionCode,
    sha256: value.sha256,
    size: value.size,
    downloadUrl: value.downloadUrl,
    latest: value.latest,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveUpdatesConfiguration(): Promise<UpdatesConfiguration> {
  const explicit = process.env.CODEWIDE_UPDATE_URL?.trim();
  if (explicit !== undefined && explicit !== "") {
    return { status: "enabled", endpoint: validateUpdateEndpoint(explicit) };
  }
  const releases = await allOtaReleaseDirectories();
  for (const directory of releases) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as { launchAsset?: { url?: unknown } };
      if (typeof manifest.launchAsset?.url === "string") {
        return { status: "enabled", endpoint: validateUpdateEndpoint(deriveUpdateEndpoint(manifest.launchAsset.url)) };
      }
    } catch {
      // Ignore incomplete historical releases and continue to the next one.
    }
  }
  return { status: "disabled" };
}

function requireUpdateEndpoint(configuration: UpdatesConfiguration, purpose: string): string {
  if (configuration.status === "enabled") return configuration.endpoint;
  throw new Error(`CODEWIDE_UPDATE_URL is required for ${purpose}`);
}

function validateUpdateEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/api/updates")) throw new Error(`Unsafe Expo Updates endpoint ${value}`);
  return url.toString().replace(/\/$/u, "");
}

async function resolvePrivateKey(): Promise<string> {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const candidates = [
    process.env.CODEWIDE_OTA_PRIVATE_KEY,
    join(dataRoot, "codewide/ota/private-key.pem"),
    join(dataRoot, "codex-remote-ota/private-key.pem"),
  ];
  return firstPrivateFile(candidates, "OTA signing key");
}

async function validateOtaSigningKey(privateKeyPath: string): Promise<void> {
  const [privatePem, certificatePem] = await Promise.all([
    readFile(privateKeyPath, "utf8"),
    readFile(certificatePath, "utf8"),
  ]);
  const privatePublic = createPublicKey(createPrivateKey(privatePem)).export({ type: "spki", format: "der" });
  const certificatePublic = new X509Certificate(certificatePem).publicKey.export({ type: "spki", format: "der" });
  if (!Buffer.from(privatePublic).equals(Buffer.from(certificatePublic))) throw new Error("OTA private key does not match the checked-in certificate");
}

async function resolveApkSigning(): Promise<{ storeFile: string; storePassword: string; keyAlias: string; keyPassword: string }> {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const storeFile = await firstPrivateFile([
    process.env.CODEWIDE_RELEASE_STORE_FILE,
    join(dataRoot, "codewide/signing/release.keystore"),
    join(dataRoot, "codex-remote-signing/release.keystore"),
  ], "Android release keystore");
  const passwordFile = await firstPrivateFile([
    process.env.CODEWIDE_RELEASE_PASSWORD_FILE,
    join(dirname(storeFile), "release.password"),
  ], "Android release password file");
  const filePassword = (await readFile(passwordFile, "utf8")).trim();
  const storePassword = process.env.CODEWIDE_RELEASE_STORE_PASSWORD ?? filePassword;
  const keyPassword = process.env.CODEWIDE_RELEASE_KEY_PASSWORD ?? filePassword;
  const keyAlias = process.env.CODEWIDE_RELEASE_KEY_ALIAS ?? "codex-remote-v1";
  if (storePassword === "" || keyPassword === "" || keyAlias === "") throw new Error("Android release signing credentials are empty");
  return { storeFile, storePassword, keyAlias, keyPassword };
}

async function validateApkSigning(signing: { storeFile: string; storePassword: string; keyAlias: string }): Promise<void> {
  const keytool = await resolveKeytool();
  await run(keytool, ["-list", "-keystore", signing.storeFile, "-storepass", signing.storePassword, "-alias", signing.keyAlias], {}, false);
}

async function resolveKeytool(): Promise<string> {
  return join(await resolveJavaHome(), "bin/keytool");
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
    if (await isExecutable(join(javaHome, "bin/java")) && await isExecutable(join(javaHome, "bin/keytool"))) return javaHome;
  }
  throw new Error("Android release JDK was not found in JAVA_HOME or the standard CodeWide JDK directories");
}

async function firstPrivateFile(candidates: Array<string | undefined>, label: string): Promise<string> {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate.trim() === "") continue;
    const path = resolve(candidate);
    const metadata = await stat(path).catch(() => null);
    if (metadata?.isFile() !== true) continue;
    if ((metadata.mode & 0o077) !== 0) throw new Error(`${label} must not be group/world accessible: ${path}`);
    return path;
  }
  throw new Error(`${label} was not found in the environment or standard CodeWide data directories`);
}

async function readCurrentVersion(): Promise<AndroidReleaseVersion> {
  return readAndroidReleaseVersion(await readReleaseSourceFiles());
}

async function readReleaseSourceFiles(): Promise<{ appConfig: string; gradle: string; manifest: string }> {
  const [appConfig, gradle, manifest] = await Promise.all([
    readFile(appConfigPath, "utf8"),
    readFile(gradlePath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  return { appConfig, gradle, manifest };
}

async function writeReleaseSourceFiles(files: { appConfig: string; gradle: string; manifest: string }): Promise<void> {
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

async function atomicNewFile(path: string, content: string): Promise<void> {
  const temporary = `${path}.release-${process.pid}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

async function otaReleaseDirectories(runtimeVersion: string): Promise<string[]> {
  const runtimeRoot = join(otaRoot, runtimeVersion);
  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".staging-")).map((entry) => join(runtimeRoot, entry.name));
}

async function allOtaReleaseDirectories(): Promise<string[]> {
  const runtimes = await readdir(otaRoot, { withFileTypes: true }).catch(() => []);
  const directories = (await Promise.all(runtimes.filter((entry) => entry.isDirectory()).map((entry) => otaReleaseDirectories(entry.name)))).flat();
  const withTimes = await Promise.all(directories.map(async (directory) => ({ directory, mtime: (await stat(directory)).mtimeMs })));
  return withTimes.sort((left, right) => right.mtime - left.mtime).map(({ directory }) => directory);
}

async function requireHealthyShelf(endpoint: string): Promise<void> {
  await requestLocalShelf("/healthz", "local build shelf health");
  await expectOk(await fetch(new URL("/api/builds", new URL(endpoint).origin), { cache: "no-store" }), "public build shelf health").arrayBuffer();
}

async function requestLocalShelf(path: string, label: string): Promise<Buffer> {
  const target = new URL(path, localShelfUrl);
  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const request = httpGet(target, { headers: { accept: "application/json" } }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", rejectPromise);
      response.once("end", () => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) rejectPromise(new Error(`${label} failed with HTTP ${status}`));
        else resolvePromise(Buffer.concat(chunks));
      });
    });
    request.once("error", rejectPromise);
  });
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

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false);
}

function expectOk(response: Response, label: string): Response {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return response;
}

function compactUtcTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
}

async function acquireLock() {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Another Android release is active (${lockPath})`);
    throw error;
  }
}

async function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, showOutput = true): Promise<void> {
  process.stderr.write(`\n[release] ${command} ${redactedArguments(args).join(" ")}\n`);
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: showOutput ? "inherit" : ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    if (!showOutput && child.stderr !== null) child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} failed (${signal ?? `exit ${code ?? "unknown"}`})${stderr === "" ? "" : `: ${stderr.trim()}`}`));
    });
  });
}

function redactedArguments(args: string[]): string[] {
  return args.map((argument, index) => args[index - 1] === "-storepass" ? "<redacted>" : argument);
}

function parseArguments(args: string[]): {
  mode: ReleaseMode;
  dryRun: boolean;
  requestedVersion?: string | undefined;
  requestedVersionCode?: number | undefined;
} {
  const mode = args[0];
  if (mode !== "ota" && mode !== "apk") {
    throw new Error("Usage: release-android.ts <ota|apk> [--dry-run] [--version X.Y.Z] [--version-code N]");
  }
  let dryRun = false;
  let requestedVersion: string | undefined;
  let requestedVersionCode: number | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") dryRun = true;
    else if (argument === "--version") {
      requestedVersion = args[index + 1];
      if (requestedVersion === undefined) throw new Error("--version requires X.Y.Z");
      index += 1;
    } else if (argument === "--version-code") {
      const raw = args[index + 1];
      if (raw === undefined || !/^\d+$/u.test(raw)) throw new Error("--version-code requires a positive integer");
      requestedVersionCode = Number(raw);
      if (!Number.isSafeInteger(requestedVersionCode) || requestedVersionCode <= 0) {
        throw new Error("--version-code requires a positive safe integer");
      }
      index += 1;
    } else throw new Error(`Unknown release argument ${argument ?? ""}`);
  }
  return { mode, dryRun, requestedVersion, requestedVersionCode };
}

function relativeToRepo(path: string): string {
  return path.startsWith(`${repoRoot}/`) ? path.slice(repoRoot.length + 1) : path;
}

function printResult(result: JsonObject): void {
  process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
}
