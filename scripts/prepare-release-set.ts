#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  readReleaseDelivery,
  releaseProductIds,
  releaseTag,
  releaseVersion,
  type ReleaseDelivery,
  type ReleaseProduct,
  type ReleaseProductAsset,
} from "./release-product-contract.ts";

type ReleasePlan = {
  readonly base: string;
  readonly sourceRevision: string;
  readonly version: string;
  readonly tag: string;
  readonly affected: readonly string[];
  readonly targets: readonly ReleaseDelivery[];
};

type Asset = ReleaseProductAsset;

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${field} must be a non-empty string`);
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
  const version = releaseVersion(plan.version);
  const tag = releaseTag(plan.tag);
  const sourceRevision = string(plan.sourceRevision, "sourceRevision");
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision))
    throw new Error("sourceRevision must be a full Git SHA");
  if (!Array.isArray(plan.targets)) throw new Error("targets must be an array");
  const targets = plan.targets.map(readReleaseDelivery);
  if (
    targets.length !== releaseProductIds.length ||
    new Set(targets.map(({ id }) => id)).size !== releaseProductIds.length
  ) {
    throw new Error("An atomic CodeWide release requires all four products");
  }
  for (const target of targets) {
    if (
      target.delivery === "build" &&
      (target.sourceTag !== tag || target.sourceRevision !== sourceRevision)
    ) {
      throw new Error("Built product must belong to this release revision and tag");
    }
  }
  return {
    base: string(plan.base, "base"),
    sourceRevision,
    version,
    tag,
    affected: stringList(plan.affected, "affected"),
    targets,
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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
  const result = spawnSync("git", ["log", "--no-merges", "--format=%s", `${base}..${head}`], {
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`Could not read release changes: ${result.stderr.trim()}`);
  return result.stdout.split("\n").filter((line) => line.length > 0);
}

function releaseNotes(plan: ReleasePlan, assets: readonly Asset[]): string {
  const changes = gitLog(plan.base, plan.sourceRevision);
  return [
    `# CodeWide ${plan.tag}`,
    "",
    `Release set from commit \`${plan.sourceRevision.slice(0, 12)}\`. Unchanged products retain their original versions and build revisions.`,
    "",
    ...plan.targets.map(
      (target) =>
        `- ${target.id}: ${target.version} (${target.delivery}, source \`${target.sourceRevision.slice(0, 12)}\`)`,
    ),
    "",
    "## Changes",
    "",
    ...(changes.length === 0
      ? ["No commits since the previous release."]
      : changes.map((subject) => `- ${subject}`)),
    "",
    "## Downloads",
    "",
    ...assets
      .filter(({ name }) => !name.endsWith(".sha256"))
      .map(
        ({ name }) =>
          `- [${name}](https://github.com/MrFlashAccount/CodeWide/releases/download/${plan.tag}/${name})`,
      ),
    "",
    "Checksums are in `SHA256SUMS`. The macOS app is signed for Sparkle updates but is not notarized.",
    "",
  ].join("\n");
}

function androidAssetName(version: string): string {
  const versionParts = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (versionParts === null) throw new Error("Invalid release version");
  const major = Number(versionParts[1]);
  const minor = Number(versionParts[2]);
  const patch = Number(versionParts[3]);
  const code = major * 100000000 + minor * 100000 + patch;
  if (!Number.isSafeInteger(code) || major > 20 || minor > 999 || patch > 99999)
    throw new Error("Android version cannot be represented as a versionCode");
  return `CodeWide-${version}-${code}.apk`;
}

function productFiles(
  target: ReleaseDelivery,
): readonly { readonly name: string; readonly artifact: string; readonly filename: string }[] {
  const version = target.version;
  switch (target.id) {
    case "relay":
      return [
        {
          name: "codewide-relay-x86_64-unknown-linux-musl",
          artifact: `codewide-relay-${version}-linux-x86_64`,
          filename: "codewide-relay-x86_64-unknown-linux-musl",
        },
      ];
    case "companion-linux": {
      const name = `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`;
      return [{ name, artifact: `codewide-companion-${version}-linux-x86_64`, filename: name }];
    }
    case "macos":
      return [
        {
          name: `CodeWide-${version}.dmg`,
          artifact: `CodeWide-${version}`,
          filename: `CodeWide-${version}.dmg`,
        },
        { name: "appcast.xml", artifact: `CodeWide-${version}`, filename: "appcast.xml" },
      ];
    case "android-apk":
      return [
        {
          name: androidAssetName(version),
          artifact: `CodeWide-Android-${version}`,
          filename: "app-release.apk",
        },
      ];
  }
}

function stageProduct(target: ReleaseDelivery, root: string, output: string): ReleaseProduct {
  const files = productFiles(target);
  if (
    target.delivery === "reuse" &&
    (target.assets.length !== files.length ||
      files.some(({ name }) => !target.assets.some((asset) => asset.name === name)))
  ) {
    throw new Error(`Reused ${target.id} assets do not match its declared version`);
  }
  const assets = files.map(({ name, artifact, filename }) => {
    const path =
      target.delivery === "reuse"
        ? join(root, "reused-products", name)
        : join(root, artifact, filename);
    if (target.delivery === "build" && target.id !== "macos") verifyChecksum(path);
    if (target.delivery === "reuse") {
      const original = target.assets.find((asset) => asset.name === name);
      if (
        original === undefined ||
        readFileSync(path).length !== original.size ||
        sha256(path) !== original.sha256
      ) {
        throw new Error(`Reused asset checksum mismatch: ${name}`);
      }
    }
    if (name === "appcast.xml") {
      const feed = readFileSync(path, "utf8");
      if (
        !feed.includes(`/releases/download/${target.sourceTag}/CodeWide-${target.version}.dmg`) ||
        !feed.includes("sparkle:edSignature=")
      ) {
        throw new Error("Signed macOS appcast does not point to this product's DMG");
      }
    }
    return stageAsset(path, name, output);
  });
  return {
    id: target.id,
    version: target.version,
    sourceRevision: target.sourceRevision,
    sourceTag: target.sourceTag,
    assets,
  };
}

export function prepareReleaseSet(
  planPath: string,
  artifactRoot: string,
  outputRoot: string,
): void {
  const plan = readPlan(planPath);
  const assetRoot = join(outputRoot, "assets");
  mkdirSync(assetRoot, { recursive: true });

  const products = plan.targets.map((target) => stageProduct(target, artifactRoot, assetRoot));
  const primaryAssets = products.flatMap(({ assets }) => assets);
  const assets = [
    ...primaryAssets,
    ...primaryAssets
      .filter(({ name }) => name !== "appcast.xml" && !name.endsWith(".dmg"))
      .map((asset) => stageChecksum(asset, assetRoot)),
  ];
  const sums = assets.map(({ name, sha256: digest }) => `${digest}  ${name}`).join("\n");
  writeFileSync(join(assetRoot, "SHA256SUMS"), `${sums}\n`);
  writeFileSync(
    join(assetRoot, "release-manifest.json"),
    `${JSON.stringify(
      {
        tag: plan.tag,
        sourceRevision: plan.sourceRevision,
        affected: plan.affected,
        products,
        assets,
      },
      null,
      2,
    )}\n`,
  );
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
    process.stderr.write(
      `prepare-release-set: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
