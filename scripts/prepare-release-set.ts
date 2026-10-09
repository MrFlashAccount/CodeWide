#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
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
  readonly previousVersion: string;
  readonly tag: string;
  readonly affected: readonly string[];
  readonly targets: readonly ReleasePlanTarget[];
};

type ReleasePlanTarget = ReleaseDelivery & {
  readonly previousVersion: string;
};

export type HostUpdateSigningOptions = {
  readonly privateKeyPem: string;
  readonly publicKeySpki: string;
  readonly keyId: string;
  readonly previousManifestPath?: string;
  readonly nowMs?: number;
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
  const previousVersion = releaseVersion(plan.previousVersion);
  const sourceRevision = string(plan.sourceRevision, "sourceRevision");
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision))
    throw new Error("sourceRevision must be a full Git SHA");
  if (!Array.isArray(plan.targets)) throw new Error("targets must be an array");
  const targets = plan.targets.map((value): ReleasePlanTarget => {
    const target = record(value, "target");
    return {
      ...readReleaseDelivery(target),
      previousVersion: releaseVersion(target.previousVersion),
    };
  });
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
    previousVersion,
    tag,
    affected: stringList(plan.affected, "affected"),
    targets,
  };
}

function releaseSequence(version: string): number {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) throw new Error("Invalid release version");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const sequence = major * 1_000_000_000_000 + minor * 1_000_000 + patch;
  if (!Number.isSafeInteger(sequence) || major > 20 || minor > 999 || patch > 99999) {
    throw new Error("Release version cannot be represented as a monotonic sequence");
  }
  return sequence;
}

function signingOptionsFromEnvironment(): HostUpdateSigningOptions {
  const privateKeyPem = process.env.CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY;
  const publicKeySpki = process.env.CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI;
  const keyId = process.env.CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID;
  if (privateKeyPem === undefined || privateKeyPem.length === 0) {
    throw new Error("CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY is required");
  }
  if (publicKeySpki === undefined || publicKeySpki.length === 0) {
    throw new Error("CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI is required");
  }
  if (keyId === undefined || !/^[a-zA-Z0-9_-]{1,64}$/u.test(keyId)) {
    throw new Error("CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID is required and must be a stable key id");
  }
  return {
    privateKeyPem,
    publicKeySpki,
    keyId,
    ...(process.env.CODEWIDE_PREVIOUS_RELEASE_MANIFEST === undefined
      ? {}
      : { previousManifestPath: process.env.CODEWIDE_PREVIOUS_RELEASE_MANIFEST }),
  };
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function previousTargetDigests(
  path: string | undefined,
  publicKey: ReturnType<typeof createPublicKey>,
  keyId: string,
  maximumSequence: number,
  expectedVersions: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  if (path === undefined) return new Map();
  const envelope = record(JSON.parse(readFileSync(path, "utf8")) as unknown, "previous release manifest");
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== "ES256" || envelope.keyId !== keyId) {
    throw new Error("Previous release manifest uses an unsupported signing contract");
  }
  const payload = Buffer.from(string(envelope.payload, "previous payload"), "base64url");
  const signature = Buffer.from(string(envelope.signature, "previous signature"), "base64");
  if (!verify("sha256", payload, publicKey, signature)) {
    throw new Error("Previous release manifest signature is invalid");
  }
  const descriptor = record(JSON.parse(payload.toString("utf8")) as unknown, "previous descriptor");
  const sequence = descriptor.sequence;
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.channel !== "stable" ||
    !Number.isSafeInteger(sequence) ||
    Number(sequence) >= maximumSequence ||
    !Array.isArray(descriptor.targets)
  ) {
    throw new Error("Previous release manifest sequence is not older than this release");
  }
  const digests = new Map<string, string>();
  for (const value of descriptor.targets) {
    const target = record(value, "previous target");
    const platform = string(target.platform, "previous target.platform");
    const digest = string(target.sha256, "previous target.sha256");
    const version = string(target.version, "previous target.version");
    if (
      version !== expectedVersions.get(platform) ||
      !/^[0-9a-f]{64}$/u.test(digest) ||
      digests.has(platform)
    ) {
      throw new Error("Previous release manifest contains invalid target digests");
    }
    digests.set(platform, digest);
  }
  return digests;
}

function signedHostUpdateManifest(
  plan: ReleasePlan,
  products: readonly ReleaseProduct[],
  options: HostUpdateSigningOptions,
): Readonly<Record<string, unknown>> {
  const privateKey = createPrivateKey(options.privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Host-update signing key must be a P-256 private key");
  }
  const publicKey = createPublicKey(privateKey);
  const derivedSpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  if (derivedSpki !== options.publicKeySpki) {
    throw new Error("Host-update signing private key does not match the pinned public SPKI");
  }
  const linux = requiredProduct(products, "companion-linux");
  const macos = requiredProduct(products, "macos");
  const linuxAsset = requiredProductAsset(linux, (name) => name.endsWith(".tar.gz"));
  const macosAsset = requiredProductAsset(macos, (name) => name.endsWith(".dmg"));
  const expectedPreviousVersions = new Map<string, string>([
    ["linux-x86-64", requiredPlanTarget(plan, "companion-linux").previousVersion],
    ["macos-universal", requiredPlanTarget(plan, "macos").previousVersion],
  ]);
  const sequence = releaseSequence(plan.version);
  const rollback = previousTargetDigests(
    options.previousManifestPath,
    publicKey,
    options.keyId,
    sequence,
    expectedPreviousVersions,
  );
  const issuedAt = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const expiresAt = issuedAt + 180 * 24 * 60 * 60;
  const artifactPrefix = `https://github.com/MrFlashAccount/CodeWide/releases/download/${plan.tag}/`;
  const versionParts = /^(\d+)\.(\d+)\.(\d+)$/u.exec(macos.version);
  if (versionParts === null) throw new Error("Invalid release version");
  const major = Number(versionParts[1]);
  const minor = Number(versionParts[2]);
  const patch = Number(versionParts[3]);
  const descriptor = {
    schemaVersion: 1,
    channel: "stable",
    sequence,
    issuedAt,
    expiresAt,
    targets: [
      {
        platform: "linux-x86-64",
        version: linux.version,
        build: linux.sourceRevision.slice(0, 12),
        sourceRevision: linux.sourceRevision,
        artifactUrl: `${artifactPrefix}${linuxAsset.name}`,
        sha256: linuxAsset.sha256,
        bootstrapVersion: 1,
        journalVersion: 1,
        stateEpoch: 1,
        rollbackCompatibleFrom: rollbackDigest(rollback, "linux-x86-64"),
      },
      {
        platform: "macos-universal",
        version: macos.version,
        build: `${200000 + major}.${minor}.${patch}`,
        sourceRevision: macos.sourceRevision,
        artifactUrl: `${artifactPrefix}${macosAsset.name}`,
        sha256: macosAsset.sha256,
        bootstrapVersion: 1,
        journalVersion: 1,
        stateEpoch: 1,
        rollbackCompatibleFrom: rollbackDigest(rollback, "macos-universal"),
      },
    ],
  };
  const payload = Buffer.from(JSON.stringify(descriptor), "utf8");
  return {
    schemaVersion: 1,
    keyId: options.keyId,
    algorithm: "ES256",
    payload: base64Url(payload),
    signature: sign("sha256", payload, privateKey).toString("base64"),
  };
}

function requiredProduct(
  products: readonly ReleaseProduct[],
  id: ReleaseProduct["id"],
): ReleaseProduct {
  const product = products.find((candidate) => candidate.id === id);
  if (product === undefined) throw new Error(`Release product is missing: ${id}`);
  return product;
}

function requiredProductAsset(
  product: ReleaseProduct,
  matches: (name: string) => boolean,
): Asset {
  const asset = product.assets.find(({ name }) => matches(name));
  if (asset === undefined) throw new Error(`Release product asset is missing: ${product.id}`);
  return asset;
}

function requiredPlanTarget(
  plan: ReleasePlan,
  id: ReleaseProduct["id"],
): ReleasePlanTarget {
  const target = plan.targets.find((candidate) => candidate.id === id);
  if (target === undefined) throw new Error(`Release target is missing: ${id}`);
  return target;
}

function rollbackDigest(digests: ReadonlyMap<string, string>, platform: string): readonly string[] {
  const digest = digests.get(platform);
  return digest === undefined ? [] : [digest];
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

function verifyLinuxBundleProvenance(path: string, target: ReleaseDelivery): void {
  const entry = "codewide-companion-x86_64-unknown-linux-musl/bootstrap/generation.json";
  const extracted = spawnSync("tar", ["-xOzf", path, entry], { encoding: "utf8" });
  if (extracted.error !== undefined || extracted.status !== 0) {
    throw new Error("Linux Companion bundle is missing generation provenance");
  }
  let value: unknown;
  try {
    value = JSON.parse(extracted.stdout);
  } catch {
    throw new Error("Linux Companion bundle has malformed generation provenance");
  }
  const provenance = record(value, "Linux Companion generation provenance");
  const version = string(provenance.version, "Linux Companion generation provenance.version");
  const build = string(provenance.build, "Linux Companion generation provenance.build");
  const sourceRevision = string(
    provenance.sourceRevision,
    "Linux Companion generation provenance.sourceRevision",
  );
  if (
    provenance.schemaVersion !== 1 ||
    Object.keys(provenance).length !== 4 ||
    version !== target.version ||
    build !== target.sourceRevision.slice(0, 12) ||
    sourceRevision !== target.sourceRevision
  ) {
    throw new Error("Linux Companion bundle provenance does not match the release plan");
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
    if (target.id === "companion-linux" && name.endsWith(".tar.gz")) {
      verifyLinuxBundleProvenance(path, target);
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
  signingOptions?: HostUpdateSigningOptions,
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
  const signedManifest = signedHostUpdateManifest(
    plan,
    products,
    signingOptions ?? signingOptionsFromEnvironment(),
  );
  const releaseManifest = {
    tag: plan.tag,
    sourceRevision: plan.sourceRevision,
    affected: plan.affected,
    products,
    assets,
    ...signedManifest,
  };
  writeFileSync(
    join(assetRoot, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
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
