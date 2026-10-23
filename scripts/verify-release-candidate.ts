import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const { manifestPath, publicUrl } = parseArguments(process.argv.slice(2));
const manifest = readCandidateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
const publicManifestUrl = new URL(
  `manifest.json?revision=${encodeURIComponent(manifest.revision)}`,
  publicUrl,
);
const publicManifestResponse = await fetch(publicManifestUrl, { cache: "no-store" });
if (!publicManifestResponse.ok) {
  throw new Error(`Public candidate manifest failed with HTTP ${publicManifestResponse.status}`);
}
const publicManifest = readCandidateManifest(await publicManifestResponse.json());
if (
  publicManifest.revision !== manifest.revision ||
  publicManifest.generatedAt !== manifest.generatedAt ||
  publicManifest.artifact.file !== manifest.artifact.file ||
  publicManifest.artifact.publishedAt !== manifest.artifact.publishedAt ||
  publicManifest.artifact.sha256 !== manifest.artifact.sha256 ||
  publicManifest.artifact.versionCode !== manifest.artifact.versionCode ||
  publicManifest.ota.runtimeVersion !== manifest.ota.runtimeVersion ||
  publicManifest.ota.updateId !== manifest.ota.updateId ||
  publicManifest.ota.updateUrl !== manifest.ota.updateUrl
) {
  throw new Error("Public candidate manifest is stale");
}
const apkResponse = await fetch(new URL(manifest.artifact.file, publicUrl), {
  cache: "no-store",
  headers: { "accept-encoding": "gzip" },
});
if (!apkResponse.ok || apkResponse.body === null) {
  throw new Error(`Public candidate APK failed with HTTP ${apkResponse.status}`);
}
if (apkResponse.headers.get("content-encoding") !== "gzip") {
  throw new Error("Public candidate APK is not served with gzip compression");
}
const digest = createHash("sha256");
for await (const chunk of apkResponse.body) digest.update(chunk);
const publicSha256 = digest.digest("hex");
if (publicSha256 !== manifest.artifact.sha256) {
  throw new Error(`Public candidate APK hash mismatch: ${publicSha256}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      release: "android-release-candidate",
      status: "published",
      publicUrl,
      ota: manifest.ota,
      ...manifest.artifact,
    },
    null,
    2,
  )}\n`,
);

type CandidateArtifact = {
  readonly applicationId: string;
  readonly architecture: string;
  readonly checksumFile: string;
  readonly file: string;
  readonly kind: string;
  readonly publishedAt: string;
  readonly sha256: string;
  readonly size: number;
  readonly versionCode: number;
  readonly versionName: string;
};

type CandidateOta = {
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly updateId: string;
  readonly updateUrl: string;
};

type CandidateManifest = {
  readonly artifact: CandidateArtifact;
  readonly generatedAt: string;
  readonly ota: CandidateOta;
  readonly revision: string;
};

function readCandidateManifest(value: unknown): CandidateManifest {
  if (
    !isRecord(value) ||
    typeof value.generatedAt !== "string" ||
    Number.isNaN(Date.parse(value.generatedAt)) ||
    typeof value.revision !== "string" ||
    !isRecord(value.ota)
  ) {
    throw new Error("Candidate manifest is invalid");
  }
  const artifacts = value.artifacts;
  const artifact = Array.isArray(artifacts) ? artifacts[0] : undefined;
  if (
    !isRecord(artifact) ||
    typeof artifact.applicationId !== "string" ||
    typeof artifact.architecture !== "string" ||
    typeof artifact.checksumFile !== "string" ||
    typeof artifact.file !== "string" ||
    typeof artifact.kind !== "string" ||
    typeof artifact.publishedAt !== "string" ||
    Number.isNaN(Date.parse(artifact.publishedAt)) ||
    typeof artifact.sha256 !== "string" ||
    typeof artifact.size !== "number" ||
    typeof artifact.versionCode !== "number" ||
    typeof artifact.versionName !== "string"
  ) {
    throw new Error("Candidate APK descriptor is invalid");
  }
  const expectedFile = `CodeWide-Preview-${artifact.versionCode}.apk`;
  if (artifact.file !== expectedFile || artifact.checksumFile !== `${expectedFile}.sha256`) {
    throw new Error("Candidate APK filename must contain its versionCode");
  }
  const ota = value.ota;
  if (
    typeof ota.createdAt !== "string" ||
    typeof ota.runtimeVersion !== "string" ||
    typeof ota.updateId !== "string" ||
    typeof ota.updateUrl !== "string"
  ) {
    throw new Error("Candidate OTA descriptor is invalid");
  }
  return {
    artifact: {
      applicationId: artifact.applicationId,
      architecture: artifact.architecture,
      checksumFile: artifact.checksumFile,
      file: artifact.file,
      kind: artifact.kind,
      publishedAt: artifact.publishedAt,
      sha256: artifact.sha256,
      size: artifact.size,
      versionCode: artifact.versionCode,
      versionName: artifact.versionName,
    },
    generatedAt: value.generatedAt,
    ota: {
      createdAt: ota.createdAt,
      runtimeVersion: ota.runtimeVersion,
      updateId: ota.updateId,
      updateUrl: ota.updateUrl,
    },
    revision: value.revision,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(values: readonly string[]): {
  readonly manifestPath: string;
  readonly publicUrl: string;
} {
  let manifestPath: string | undefined;
  let publicUrl: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (argument === "--manifest") manifestPath = value;
    else if (argument === "--public-url") publicUrl = value;
    else throw new Error(`Unknown candidate verification argument: ${argument ?? ""}`);
    if (value === undefined) throw new Error(`${argument ?? "argument"} requires a value`);
    index += 1;
  }
  if (manifestPath === undefined || publicUrl === undefined) {
    throw new Error("Usage: verify-release-candidate.ts --manifest PATH --public-url HTTPS_URL");
  }
  const url = new URL(publicUrl);
  if (url.protocol !== "https:") throw new Error(`Unsafe candidate public URL: ${publicUrl}`);
  return { manifestPath: resolve(manifestPath), publicUrl: url.toString() };
}
