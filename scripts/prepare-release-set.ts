#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

type ReleasePlan = {
  readonly base: string;
  readonly sourceRevision: string;
  readonly version: string;
  readonly tag: string;
  readonly affected: readonly string[];
  readonly targets: readonly string[];
};

type Asset = {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
};

const requiredTargets = ["relay", "companion-linux", "macos", "android-apk"];

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function stringList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a string array`);
  }
  return value;
}

function readPlan(path: string): ReleasePlan {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  const plan = record(value, "release plan");
  const version = string(plan.version, "version");
  if (!/^\d+\.\d+\.\d+$/u.test(version) || plan.tag !== `v${version}`) {
    throw new Error("Release tag and semantic version disagree");
  }
  const sourceRevision = string(plan.sourceRevision, "sourceRevision");
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision)) throw new Error("sourceRevision must be a full Git SHA");
  if (!Array.isArray(plan.targets)) throw new Error("targets must be an array");
  const targets = plan.targets.map((target) => string(record(target, "target").id, "target.id"));
  if (targets.length !== requiredTargets.length || requiredTargets.some((id) => !targets.includes(id))) {
    throw new Error("An atomic CodeWide release requires all four products");
  }
  return {
    base: string(plan.base, "base"),
    sourceRevision,
    version,
    tag: `v${version}`,
    affected: stringList(plan.affected, "affected"),
    targets,
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourcePath(root: string, artifact: string, filename: string): string {
  return join(root, artifact, filename);
}

function verifyChecksum(path: string): void {
  const checksum = readFileSync(`${path}.sha256`, "utf8").trim();
  const match = /^([0-9a-f]{64})\s+\*?([^\s]+)$/u.exec(checksum);
  if (match === null || match[1] !== sha256(path) || basename(match[2] ?? "") !== basename(path)) {
    throw new Error(`Invalid source checksum for ${basename(path)}`);
  }
}

function stageAsset(path: string, name: string, output: string): Asset {
  const destination = join(output, name);
  copyFileSync(path, destination);
  const bytes = readFileSync(destination);
  return { name, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function stageChecksum(asset: Asset, output: string): Asset {
  const name = `${asset.name}.sha256`;
  const path = join(output, name);
  writeFileSync(path, `${asset.sha256}  ${asset.name}\n`);
  const bytes = readFileSync(path);
  return { name, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function gitLog(base: string, head: string): readonly string[] {
  const result = spawnSync("git", ["log", "--no-merges", "--format=%s", `${base}..${head}`], { encoding: "utf8" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`Could not read release changes: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

function releaseNotes(plan: ReleasePlan, assets: readonly Asset[]): string {
  const changes = gitLog(plan.base, plan.sourceRevision);
  return [
    `# CodeWide ${plan.tag}`,
    "",
    `One build from commit \`${plan.sourceRevision.slice(0, 12)}\`: Android APK, macOS app and signed update feed, Linux Companion, and Relay.`,
    "",
    "## Changes",
    "",
    ...(changes.length === 0 ? ["No commits since the previous release."] : changes.map((subject) => `- ${subject}`)),
    "",
    "## Downloads",
    "",
    ...assets.filter(({ name }) => !name.endsWith(".sha256")).map(({ name }) => `- [${name}](https://github.com/MrFlashAccount/CodeWide/releases/download/${plan.tag}/${name})`),
    "",
    "Checksums are in `SHA256SUMS`. The macOS app is signed for Sparkle updates but is not notarized.",
    "",
  ].join("\n");
}

export function prepareReleaseSet(planPath: string, artifactRoot: string, outputRoot: string): void {
  const plan = readPlan(planPath);
  const version = plan.version;
  const assetRoot = join(outputRoot, "assets");
  mkdirSync(assetRoot, { recursive: true });

  const relay = sourcePath(artifactRoot, `codewide-relay-${version}-linux-x86_64`, "codewide-relay-x86_64-unknown-linux-musl");
  const companionName = `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`;
  const companion = sourcePath(artifactRoot, `codewide-companion-${version}-linux-x86_64`, companionName);
  const dmgName = `CodeWide-${version}.dmg`;
  const dmg = sourcePath(artifactRoot, `CodeWide-${version}`, dmgName);
  const appcast = sourcePath(artifactRoot, `CodeWide-${version}`, "appcast.xml");
  const apk = sourcePath(artifactRoot, `CodeWide-Android-${version}`, "app-release.apk");
  for (const path of [relay, companion, apk]) verifyChecksum(path);
  const feed = readFileSync(appcast, "utf8");
  if (!feed.includes(`/releases/download/${plan.tag}/${dmgName}`) || !feed.includes("sparkle:edSignature=")) {
    throw new Error("Signed macOS appcast does not point to this release's DMG");
  }
  const versionParts = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (versionParts === null) throw new Error("Invalid release version");
  const major = Number(versionParts[1]);
  const minor = Number(versionParts[2]);
  const patch = Number(versionParts[3]);
  const androidVersionCode = major * 100000000 + minor * 100000 + patch;
  if (!Number.isSafeInteger(androidVersionCode) || major > 20 || minor > 999 || patch > 99999) {
    throw new Error("Android version cannot be represented as a versionCode");
  }
  const primaryAssets = [
    stageAsset(relay, basename(relay), assetRoot),
    stageAsset(companion, companionName, assetRoot),
    stageAsset(dmg, dmgName, assetRoot),
    stageAsset(appcast, "appcast.xml", assetRoot),
    stageAsset(apk, `CodeWide-${version}-${androidVersionCode}.apk`, assetRoot),
  ];
  const assets = [
    ...primaryAssets,
    ...primaryAssets.filter(({ name }) => name !== "appcast.xml" && !name.endsWith(".dmg"))
      .map((asset) => stageChecksum(asset, assetRoot)),
  ];
  const sums = assets.map(({ name, sha256: digest }) => `${digest}  ${name}`).join("\n");
  writeFileSync(join(assetRoot, "SHA256SUMS"), `${sums}\n`);
  writeFileSync(join(assetRoot, "release-manifest.json"), `${JSON.stringify({
    tag: plan.tag,
    sourceRevision: plan.sourceRevision,
    affected: plan.affected,
    assets,
  }, null, 2)}\n`);
  writeFileSync(join(outputRoot, "release-notes.md"), releaseNotes(plan, assets));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const [planPath, artifactRoot, outputRoot] = process.argv.slice(2);
    if (planPath === undefined || artifactRoot === undefined || outputRoot === undefined) {
      throw new Error("Usage: prepare-release-set <plan.json> <downloaded-artifacts> <output>");
    }
    prepareReleaseSet(planPath, artifactRoot, outputRoot);
  } catch (error) {
    process.stderr.write(`prepare-release-set: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
