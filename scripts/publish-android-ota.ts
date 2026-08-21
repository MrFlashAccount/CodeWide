import { createHash, sign } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

type ExportMetadata = {
  fileMetadata: {
    android?: {
      bundle: string;
      assets: Array<{ path: string; ext: string }>;
    };
  };
};

type AppConfig = {
  expo?: {
    runtimeVersion?: string;
    updates?: { url?: string };
    [key: string]: unknown;
  };
};

type AssetMetadata = {
  hash: string;
  key: string;
  fileExtension: string;
  contentType: string;
  url: string;
};

const repoRoot = resolve(import.meta.dirname, "..");
const appRoot = join(repoRoot, "apps/android");
const appConfigPath = join(appRoot, "app.json");
const otaRoot = join(repoRoot, "builds/ota");
const userDataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
const privateKeyPath = resolve(
  process.env.CODEWIDE_OTA_PRIVATE_KEY
    ?? join(userDataRoot, "codewide/ota/private-key.pem"),
);

const appConfig = JSON.parse(await readFile(appConfigPath, "utf8")) as AppConfig;
const runtimeVersion = appConfig.expo?.runtimeVersion;
const updateUrl = process.env.CODEWIDE_UPDATE_URL ?? appConfig.expo?.updates?.url;
if (typeof runtimeVersion !== "string" || runtimeVersion.length === 0) {
  throw new Error("apps/android/app.json must define expo.runtimeVersion");
}
if (typeof updateUrl !== "string" || !updateUrl.startsWith("https://") || updateUrl.includes("example.invalid")) {
  throw new Error("Set CODEWIDE_UPDATE_URL to the deployment HTTPS Expo Updates endpoint");
}
const privateKeyMode = (await stat(privateKeyPath)).mode & 0o777;
if ((privateKeyMode & 0o077) !== 0) {
  throw new Error(`OTA private key must not be group/world accessible: ${privateKeyPath}`);
}
const privateKey = await readFile(privateKeyPath, "utf8");
const updateIdSeed = `${Date.now()}-${process.pid}`;
const stagingRoot = join(otaRoot, `.staging-${updateIdSeed}`);
await mkdir(dirname(stagingRoot), { recursive: true });

try {
  const exported = spawnSync(
    "pnpm",
    ["exec", "expo", "export", "--platform", "android", "--output-dir", stagingRoot],
    { cwd: appRoot, stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
  );
  if (exported.status !== 0) throw new Error(`expo export failed with status ${exported.status ?? "unknown"}`);

  const metadataBytes = await readFile(join(stagingRoot, "metadata.json"));
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as ExportMetadata;
  const android = metadata.fileMetadata.android;
  if (android === undefined) throw new Error("Expo export did not produce Android metadata");
  const launchBytes = await readFile(safeExportPath(stagingRoot, android.bundle));
  const rawId = createHash("sha256").update(metadataBytes).update(launchBytes).digest("hex");
  const updateId = sha256ToUuid(rawId);
  const createdAt = new Date().toISOString();
  const encodedRuntime = encodeURIComponent(runtimeVersion);
  const encodedUpdate = encodeURIComponent(updateId);
  const assetBaseUrl = `${updateUrl}/assets/${encodedRuntime}/${encodedUpdate}`;

  const assets = await Promise.all(android.assets.map(async (asset) => (
    assetMetadata(stagingRoot, asset.path, asset.ext, `${assetBaseUrl}/${encodePath(asset.path)}`, false)
  )));
  const launchAsset = await assetMetadata(
    stagingRoot,
    android.bundle,
    "bundle",
    `${assetBaseUrl}/${encodePath(android.bundle)}`,
    true,
  );
  const manifest = {
    id: updateId,
    createdAt,
    runtimeVersion,
    assets,
    launchAsset,
    metadata: {},
    extra: { expoClient: appConfig.expo ?? {} },
  };
  const manifestBody = JSON.stringify(manifest);
  const noUpdateBody = JSON.stringify({ type: "noUpdateAvailable" });
  await Promise.all([
    writeFile(join(stagingRoot, "manifest.json"), manifestBody, { encoding: "utf8", mode: 0o644 }),
    writeFile(join(stagingRoot, "manifest.sig"), signBody(manifestBody, privateKey), { encoding: "utf8", mode: 0o644 }),
    writeFile(join(stagingRoot, "no-update.json"), noUpdateBody, { encoding: "utf8", mode: 0o644 }),
    writeFile(join(stagingRoot, "no-update.sig"), signBody(noUpdateBody, privateKey), { encoding: "utf8", mode: 0o644 }),
    writeFile(join(stagingRoot, "release.json"), `${JSON.stringify({ updateId, runtimeVersion, createdAt }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 }),
  ]);

  const runtimeRoot = join(otaRoot, safeSegment(runtimeVersion));
  await mkdir(runtimeRoot, { recursive: true });
  const destination = join(runtimeRoot, `${Date.now()}-${updateId.slice(0, 8)}`);
  await rename(stagingRoot, destination);
  console.log(JSON.stringify({ updateId, runtimeVersion, createdAt, directory: relative(repoRoot, destination) }, null, 2));
} catch (error) {
  await rm(stagingRoot, { recursive: true, force: true });
  throw error;
}

async function assetMetadata(
  root: string,
  path: string,
  ext: string,
  url: string,
  launch: boolean,
): Promise<AssetMetadata> {
  const bytes = await readFile(safeExportPath(root, path));
  return {
    hash: createHash("sha256").update(bytes).digest("base64url"),
    key: createHash("md5").update(bytes).digest("hex"),
    fileExtension: launch ? ".bundle" : `.${ext}`,
    contentType: launch ? "application/javascript" : mimeForExtension(ext),
    url,
  };
}

function safeExportPath(root: string, path: string): string {
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`Unsafe exported path: ${path}`);
  return resolved;
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`Unsafe runtime version: ${value}`);
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
  return ({
    gif: "image/gif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    json: "application/json",
    otf: "font/otf",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    webp: "image/webp",
    xml: "application/xml",
  } as Record<string, string>)[extension.toLowerCase()] ?? "application/octet-stream";
}
