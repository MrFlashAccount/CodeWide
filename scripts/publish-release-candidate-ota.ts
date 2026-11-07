import { createHash, createPrivateKey, createPublicKey, sign, X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

type PublishArguments = {
  readonly outputRoot: string;
  readonly runtimeVersion: string;
  readonly updateUrl: string;
};

type ExportAsset = {
  readonly ext: string;
  readonly path: string;
};

type ExportMetadata = {
  readonly assets: readonly ExportAsset[];
  readonly bundle: string;
};

type PublishedAsset = {
  readonly contentType: string;
  readonly fileExtension: string;
  readonly hash: string;
  readonly key: string;
  readonly url: string;
};

const repoRoot = resolve(import.meta.dirname, "..");
const appRoot = join(repoRoot, "apps/android");
const appConfigPath = join(appRoot, "app.json");
const certificatePath = join(appRoot, "certs/certificate.pem");

const args = parseArguments(process.argv.slice(2));
const privateKeyPath = await resolvePrivateKey();
const privateKey = await validateSigningKey(privateKeyPath);
const appConfig = await readAppConfig();
const stagingRoot = await createStagingRoot(args.outputRoot);
let publishedDestination: string | null = null;

try {
  await runExpoExport(stagingRoot);
  const metadataBytes = await readFile(join(stagingRoot, "metadata.json"));
  const metadata = readExportMetadata(JSON.parse(metadataBytes.toString("utf8")));
  const launchBytes = await readFile(safeExportPath(stagingRoot, metadata.bundle));
  const updateHash = createHash("sha256").update(metadataBytes).update(launchBytes).digest("hex");
  const updateId = sha256ToUuid(updateHash);
  const createdAt = new Date().toISOString();
  const assetBaseUrl = `${args.updateUrl}/assets/${encodeURIComponent(args.runtimeVersion)}/${encodeURIComponent(updateId)}`;
  const assets = await Promise.all(
    metadata.assets.map((asset) =>
      assetMetadata(
        stagingRoot,
        asset.path,
        asset.ext,
        `${assetBaseUrl}/${encodePath(asset.path)}`,
        false,
      ),
    ),
  );
  const launchAsset = await assetMetadata(
    stagingRoot,
    metadata.bundle,
    "bundle",
    `${assetBaseUrl}/${encodePath(metadata.bundle)}`,
    true,
  );
  const manifest = {
    assets,
    createdAt,
    extra: {
      expoClient: {
        ...appConfig,
        runtimeVersion: args.runtimeVersion,
        updates: { checkAutomatically: "NEVER", url: args.updateUrl },
      },
    },
    id: updateId,
    launchAsset,
    metadata: {},
    runtimeVersion: args.runtimeVersion,
  };
  const manifestBody = JSON.stringify(manifest);
  const noUpdateBody = JSON.stringify({ type: "noUpdateAvailable" });
  const release = {
    createdAt,
    runtimeVersion: args.runtimeVersion,
    updateId,
    updateUrl: args.updateUrl,
  };
  await Promise.all([
    writeFile(join(stagingRoot, "manifest.json"), manifestBody, { mode: 0o644 }),
    writeFile(join(stagingRoot, "manifest.sig"), signBody(manifestBody, privateKey), {
      mode: 0o644,
    }),
    writeFile(join(stagingRoot, "no-update.json"), noUpdateBody, { mode: 0o644 }),
    writeFile(join(stagingRoot, "no-update.sig"), signBody(noUpdateBody, privateKey), {
      mode: 0o644,
    }),
    writeFile(join(stagingRoot, "release.json"), `${JSON.stringify(release, null, 2)}\n`, {
      mode: 0o644,
    }),
  ]);

  const runtimeRoot = join(args.outputRoot, safeSegment(args.runtimeVersion));
  await mkdir(runtimeRoot, { recursive: true });
  const destination = join(runtimeRoot, `${Date.now()}-${updateId.slice(0, 8)}`);
  await rename(stagingRoot, destination);
  publishedDestination = destination;
  await verifyPublicUpdate(args.updateUrl, release, launchAsset);
  const pointerPath = join(runtimeRoot, "current.json");
  const temporaryPointerPath = `${pointerPath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPointerPath,
    `${JSON.stringify({ ...release, directory: relative(runtimeRoot, destination) }, null, 2)}\n`,
    { mode: 0o644 },
  );
  await rename(temporaryPointerPath, pointerPath);
  process.stdout.write(
    `${JSON.stringify({
      artifact: "built-signed-published-verified",
      directory: relative(repoRoot, destination),
      ...release,
    })}\n`,
  );
} catch (error) {
  await Promise.all([
    rm(stagingRoot, { force: true, recursive: true }),
    publishedDestination === null
      ? Promise.resolve()
      : rm(publishedDestination, { force: true, recursive: true }),
  ]);
  throw error;
}

async function createStagingRoot(outputRoot: string): Promise<string> {
  await mkdir(outputRoot, { recursive: true });
  const directory = join(outputRoot, `.staging-${process.pid}-${Date.now()}`);
  await mkdir(directory);
  return directory;
}

async function runExpoExport(outputRoot: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      "pnpm",
      ["exec", "expo", "export", "--platform", "android", "--output-dir", outputRoot],
      {
        cwd: appRoot,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: "inherit",
      },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Expo export failed (${signal ?? `exit ${code ?? "unknown"}`})`));
    });
  });
}

async function assetMetadata(
  root: string,
  path: string,
  extension: string,
  url: string,
  launch: boolean,
): Promise<PublishedAsset> {
  const bytes = await readFile(safeExportPath(root, path));
  return {
    contentType: launch ? "application/javascript" : mimeForExtension(extension),
    fileExtension: launch ? ".bundle" : `.${extension}`,
    hash: createHash("sha256").update(bytes).digest("base64url"),
    key: createHash("md5").update(bytes).digest("hex"),
    url,
  };
}

async function readAppConfig(): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(appConfigPath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.expo)) {
    throw new Error("apps/android/app.json must contain expo configuration");
  }
  return parsed.expo;
}

function readExportMetadata(value: unknown): ExportMetadata {
  if (!isRecord(value) || !isRecord(value.fileMetadata)) {
    throw new Error("Expo export metadata is invalid");
  }
  const android = value.fileMetadata.android;
  if (!isRecord(android) || typeof android.bundle !== "string" || !Array.isArray(android.assets)) {
    throw new Error("Expo export did not produce Android metadata");
  }
  const assets = android.assets.map((asset) => {
    if (!isRecord(asset) || typeof asset.path !== "string" || typeof asset.ext !== "string") {
      throw new Error("Expo export asset metadata is invalid");
    }
    return { ext: asset.ext, path: asset.path };
  });
  return { assets, bundle: android.bundle };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeExportPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe exported path: ${path}`);
  }
  return resolved;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`Unsafe OTA path segment: ${value}`);
  }
  return value;
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function signBody(body: string, privateKey: string): string {
  return sign("RSA-SHA256", Buffer.from(body, "utf8"), privateKey).toString("base64");
}

function sha256ToUuid(value: string): string {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function mimeForExtension(extension: string): string {
  const contentTypes: Readonly<Record<string, string>> = {
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    otf: "font/otf",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    webp: "image/webp",
    xml: "application/xml",
  };
  return contentTypes[extension.toLowerCase()] ?? "application/octet-stream";
}

async function resolvePrivateKey(): Promise<string> {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const candidates = [
    process.env.CODEWIDE_OTA_PRIVATE_KEY,
    join(dataRoot, "codewide/ota/private-key.pem"),
    join(dataRoot, "codex-remote-ota/private-key.pem"),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === "") continue;
    const resolved = resolve(candidate);
    if (
      await access(resolved, constants.R_OK).then(
        () => true,
        () => false,
      )
    )
      return resolved;
  }
  throw new Error("OTA signing key was not found");
}

async function validateSigningKey(path: string): Promise<string> {
  const mode = (await stat(path)).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`OTA signing key must not be group/world accessible: ${path}`);
  }
  const [privateKey, certificate] = await Promise.all([
    readFile(path, "utf8"),
    readFile(certificatePath, "utf8"),
  ]);
  const privatePublic = createPublicKey(createPrivateKey(privateKey)).export({
    format: "der",
    type: "spki",
  });
  const certificatePublic = new X509Certificate(certificate).publicKey.export({
    format: "der",
    type: "spki",
  });
  if (!Buffer.from(privatePublic).equals(Buffer.from(certificatePublic))) {
    throw new Error("OTA signing key does not match the Android trust certificate");
  }
  return privateKey;
}

async function verifyPublicUpdate(
  updateUrl: string,
  release: { readonly runtimeVersion: string; readonly updateId: string },
  launchAsset: PublishedAsset,
): Promise<void> {
  const headers = {
    "expo-expect-signature": 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    "expo-platform": "android",
    "expo-protocol-version": "1",
    "expo-runtime-version": release.runtimeVersion,
  };
  const response = await fetch(updateUrl, { cache: "no-store", headers });
  if (!response.ok) throw new Error(`Public OTA manifest failed with HTTP ${response.status}`);
  const manifestBody = await response.text();
  if (!manifestBody.includes(release.updateId) || !manifestBody.includes("expo-signature")) {
    throw new Error("Public OTA manifest does not contain the signed published update");
  }
  const launchResponse = await fetch(launchAsset.url, { cache: "no-store" });
  if (!launchResponse.ok) {
    throw new Error(`Public OTA launch asset failed with HTTP ${launchResponse.status}`);
  }
  const launchBytes = Buffer.from(await launchResponse.arrayBuffer());
  const launchHash = createHash("sha256").update(launchBytes).digest("base64url");
  if (launchHash !== launchAsset.hash) {
    throw new Error(`Public OTA launch asset hash mismatch: ${launchHash}`);
  }
  const currentResponse = await fetch(updateUrl, {
    cache: "no-store",
    headers: { ...headers, "expo-current-update-id": release.updateId },
  });
  if (!currentResponse.ok || !(await currentResponse.text()).includes("noUpdateAvailable")) {
    throw new Error("Public OTA endpoint did not settle the published update");
  }
}

function parseArguments(values: readonly string[]): PublishArguments {
  let outputRoot: string | undefined;
  let runtimeVersion: string | undefined;
  let updateUrl: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (argument === "--output-root") outputRoot = value;
    else if (argument === "--runtime-version") runtimeVersion = value;
    else if (argument === "--update-url") updateUrl = value;
    else throw new Error(`Unknown candidate OTA argument: ${argument ?? ""}`);
    if (value === undefined) throw new Error(`${argument ?? "argument"} requires a value`);
    index += 1;
  }
  if (outputRoot === undefined || runtimeVersion === undefined || updateUrl === undefined) {
    throw new Error(
      "Usage: publish-release-candidate-ota.ts --output-root PATH --runtime-version VERSION --update-url HTTPS_URL",
    );
  }
  safeSegment(runtimeVersion);
  const endpoint = new URL(updateUrl);
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/api/updates") {
    throw new Error(`Unsafe candidate OTA endpoint: ${updateUrl}`);
  }
  return {
    outputRoot: resolve(outputRoot),
    runtimeVersion,
    updateUrl: endpoint.toString().replace(/\/$/u, ""),
  };
}
