import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = parseArguments(process.argv.slice(2));
const manifest = requiredRecord(JSON.parse(await readFile(args.manifestPath, "utf8")));
const pointer = readOtaPointer(JSON.parse(await readFile(args.otaPointerPath, "utf8")));
const artifact = readPreviewArtifact(manifest.artifacts);
const expectedRuntime = `0.0.0.0-native-${artifact.versionCode}`;
if (pointer.runtimeVersion !== expectedRuntime) {
  throw new Error(
    `OTA runtime ${pointer.runtimeVersion} does not match published Preview ${expectedRuntime}`,
  );
}

const next = {
  ...manifest,
  branch: args.branch,
  revision: args.revision,
  sourceDirty: args.sourceDirty,
  generatedAt: new Date().toISOString(),
  ota: pointer,
};
const temporaryPath = `${args.manifestPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
  await rename(temporaryPath, args.manifestPath);
} finally {
  await rm(temporaryPath, { force: true });
}

function readPreviewArtifact(value) {
  if (!Array.isArray(value)) throw new Error("Candidate manifest artifacts are invalid");
  const artifact = value.find((candidate) => candidate?.kind === "android-preview-apk");
  if (
    !isRecord(artifact) ||
    artifact.applicationId !== "dev.codexremote.app.preview" ||
    artifact.versionName !== "0.0.0.0" ||
    !Number.isSafeInteger(artifact.versionCode)
  ) {
    throw new Error("Candidate Preview APK descriptor is invalid");
  }
  return { versionCode: artifact.versionCode };
}

function readOtaPointer(value) {
  const pointer = requiredRecord(value);
  if (
    typeof pointer.createdAt !== "string" ||
    typeof pointer.runtimeVersion !== "string" ||
    typeof pointer.updateId !== "string" ||
    typeof pointer.updateUrl !== "string"
  ) {
    throw new Error("Candidate OTA pointer is invalid");
  }
  return {
    createdAt: pointer.createdAt,
    runtimeVersion: pointer.runtimeVersion,
    updateId: pointer.updateId,
    updateUrl: pointer.updateUrl,
  };
}

function requiredRecord(value) {
  if (!isRecord(value)) throw new Error("Candidate manifest is invalid");
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (value === undefined) throw new Error(`${argument ?? "argument"} requires a value`);
    if (argument === "--manifest") parsed.manifestPath = resolve(value);
    else if (argument === "--ota-pointer") parsed.otaPointerPath = resolve(value);
    else if (argument === "--branch") parsed.branch = value;
    else if (argument === "--revision") parsed.revision = value;
    else if (argument === "--source-dirty") parsed.sourceDirty = readBoolean(value);
    else throw new Error(`Unknown candidate manifest argument: ${argument ?? ""}`);
    index += 1;
  }
  if (
    parsed.manifestPath === undefined ||
    parsed.otaPointerPath === undefined ||
    parsed.branch === undefined ||
    parsed.revision === undefined ||
    parsed.sourceDirty === undefined
  ) {
    throw new Error(
      "Usage: update-release-candidate-manifest.mjs --manifest PATH --ota-pointer PATH --branch NAME --revision SHA --source-dirty BOOLEAN",
    );
  }
  return parsed;
}

function readBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid boolean: ${value}`);
}
