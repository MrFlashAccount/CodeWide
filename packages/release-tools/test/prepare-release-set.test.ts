import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { prepareReleaseSet } from "../../../scripts/prepare-release-set";
import { readReleaseProducts } from "../../../scripts/release-product-contract";

const releaseKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const signing = {
  privateKeyPem: releaseKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeySpki: releaseKey.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  keyId: "test-release-v1",
  nowMs: 1_800_000_000_000,
} as const;

const version = "0.4.1";

type HostUpdateTarget = {
  readonly artifactUrl: string;
  readonly platform: string;
  readonly sha256: string;
  readonly sourceRevision: string;
  readonly rollbackCompatibleFrom: readonly string[];
};

type HostUpdateDescriptor = {
  readonly sequence: number;
  readonly targets: readonly HostUpdateTarget[];
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const strings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    strings.push(entry);
  }
  return strings;
}

function signedPayload(path: string): { readonly payload: string; readonly signature: string } {
  const envelope: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    !isRecord(envelope) ||
    typeof envelope.payload !== "string" ||
    typeof envelope.signature !== "string"
  ) {
    throw new Error("Release manifest envelope is invalid");
  }
  return { payload: envelope.payload, signature: envelope.signature };
}

function hostUpdateDescriptor(path: string): HostUpdateDescriptor {
  const envelope = signedPayload(path);
  const descriptor: unknown = JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8"),
  );
  if (
    !isRecord(descriptor) ||
    typeof descriptor.sequence !== "number" ||
    !Array.isArray(descriptor.targets)
  ) {
    throw new Error("Release manifest descriptor is invalid");
  }
  const targets = descriptor.targets.map((value): HostUpdateTarget => {
    const rollbackCompatibleFrom = isRecord(value)
      ? stringArray(value.rollbackCompatibleFrom)
      : null;
    if (
      !isRecord(value) ||
      typeof value.artifactUrl !== "string" ||
      typeof value.platform !== "string" ||
      typeof value.sha256 !== "string" ||
      typeof value.sourceRevision !== "string" ||
      rollbackCompatibleFrom === null
    ) {
      throw new Error("Release manifest target is invalid");
    }
    return {
      artifactUrl: value.artifactUrl,
      platform: value.platform,
      sha256: value.sha256,
      sourceRevision: value.sourceRevision,
      rollbackCompatibleFrom,
    };
  });
  return { sequence: descriptor.sequence, targets };
}

function hostUpdateTargets(path: string): readonly HostUpdateTarget[] {
  return hostUpdateDescriptor(path).targets;
}

/**
 * Re-signs a produced manifest with another feed sequence, modelling a
 * predecessor published by an earlier release under the same trusted key.
 */
function resignWithSequence(path: string, sequence: number): void {
  const envelope: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(envelope) || typeof envelope.payload !== "string") {
    throw new Error("Release manifest envelope is invalid");
  }
  const descriptor: unknown = JSON.parse(
    Buffer.from(envelope.payload, "base64url").toString("utf8"),
  );
  if (!isRecord(descriptor)) throw new Error("Release manifest descriptor is invalid");
  const payload = Buffer.from(JSON.stringify({ ...descriptor, sequence }), "utf8");
  writeFileSync(
    path,
    JSON.stringify({
      ...envelope,
      payload: payload.toString("base64url"),
      signature: sign("sha256", payload, releaseKey.privateKey).toString("base64"),
    }),
  );
}

function artifactFiles(releaseVersion: string) {
  return [
    [`codewide-relay-${releaseVersion}-linux-x86_64`, "codewide-relay-x86_64-unknown-linux-musl"],
    [`codewide-relay-${releaseVersion}-linux-x86_64`, "codewide-relay-x86_64-unknown-linux-musl.tar.gz"],
    [
      `codewide-companion-${releaseVersion}-linux-x86_64`,
      `codewide-companion-${releaseVersion}-x86_64-unknown-linux-musl.tar.gz`,
    ],
    [`CodeWide-${releaseVersion}`, `CodeWide-${releaseVersion}.dmg`],
    [`CodeWide-${releaseVersion}`, "appcast.xml"],
    [`CodeWide-Android-${releaseVersion}`, "app-release.apk"],
  ] as const;
}

type FixtureOptions = {
  readonly releaseVersion?: string;
  readonly previousVersion?: string;
  readonly linuxSourceRevision?: string;
};

function fixture(
  root: string,
  options: FixtureOptions = {},
): { readonly planPath: string; readonly artifacts: string; readonly output: string } {
  const releaseVersion = options.releaseVersion ?? version;
  const linuxSourceRevision = options.linuxSourceRevision;
  mkdirSync(root, { recursive: true });
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const base = execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();
  const planPath = join(root, "plan.json");
  const artifacts = join(root, "artifacts");
  const output = join(root, "output");
  const previousVersion =
    options.previousVersion ?? (releaseVersion === version ? "0.4.0" : version);
  writeFileSync(planPath, JSON.stringify({
    base,
    sourceRevision,
    tag: `v${releaseVersion}`,
    affected: ["android-apk"],
    targets: ["relay", "companion-linux", "macos", "android-apk"].map((id) => ({
      id,
      version: releaseVersion,
      previousVersion,
      sourceRevision,
      sourceTag: `v${releaseVersion}`,
      delivery: "build",
    })),
  }));
  for (const [artifact, name] of artifactFiles(releaseVersion)) {
    const directory = join(artifacts, artifact);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    if (name.endsWith(".tar.gz")) {
      const bundleName = "codewide-companion-x86_64-unknown-linux-musl";
      const bundleRoot = join(root, "linux-bundle", bundleName);
      mkdirSync(join(bundleRoot, "bootstrap"), { recursive: true });
      const revision = linuxSourceRevision ?? sourceRevision;
      writeFileSync(
        join(bundleRoot, "bootstrap", "generation.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          version: releaseVersion,
          build: revision.slice(0, 12),
          sourceRevision: revision,
        })}\n`,
      );
      execFileSync("tar", ["-czf", path, "-C", join(root, "linux-bundle"), bundleName]);
    } else {
      const content = name === "appcast.xml"
        ? `<enclosure url="https://github.com/MrFlashAccount/CodeWide/releases/download/v${releaseVersion}/CodeWide-${releaseVersion}.dmg" sparkle:edSignature="signature"/>`
        : `validated ${name}`;
      writeFileSync(path, content);
    }
    if (name === "app-release.apk" || name.endsWith("-unknown-linux-musl") || name.endsWith(".tar.gz")) {
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      writeFileSync(`${path}.sha256`, `${digest}  ${name}\n`);
    }
  }
  return { planPath, artifacts, output };
}

function prepareReusedRelease(
  root: string,
  previousOutput: string,
  previousManifestPaths: readonly string[],
): string {
  const previousManifestPath = join(previousOutput, "assets", "release-manifest.json");
  const inventory = readReleaseProducts(JSON.parse(readFileSync(previousManifestPath, "utf8")));
  const artifacts = join(root, "artifacts");
  const reusedProducts = join(artifacts, "reused-products");
  mkdirSync(reusedProducts, { recursive: true });
  for (const product of inventory) {
    for (const asset of product.assets) {
      copyFileSync(join(previousOutput, "assets", asset.name), join(reusedProducts, asset.name));
    }
  }
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const planPath = join(root, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      base: sourceRevision,
      sourceRevision,
      tag: "release-2026-10-16.1",
      affected: [],
      targets: inventory.map((product) => ({
        ...product,
        previousVersion: product.version,
        delivery: "reuse",
      })),
    }),
  );
  const output = join(root, "output");
  prepareReleaseSet(planPath, artifacts, output, { ...signing, previousManifestPaths });
  return join(output, "assets", "release-manifest.json");
}

describe("atomic release package", () => {
  it("stages all products with verifiable checksums and human-readable notes as the first feed entry", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root);
      prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing);
      const assets = join(paths.output, "assets");
      const sums = readFileSync(join(assets, "SHA256SUMS"), "utf8");
      expect(sums).toContain(`CodeWide-${version}-400001.apk`);
      expect(sums).toContain(`CodeWide-${version}.dmg`);
      expect(sums).toContain("appcast.xml");
      for (const name of [
        "codewide-relay-x86_64-unknown-linux-musl",
        "codewide-relay-x86_64-unknown-linux-musl.tar.gz",
        `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`,
      ]) {
        const payload = readFileSync(join(assets, name));
        const digest = createHash("sha256").update(payload).digest("hex");
        expect(readFileSync(join(assets, `${name}.sha256`), "utf8")).toBe(`${digest}  ${name}\n`);
      }
      const manifestPath = join(assets, "release-manifest.json");
      const manifest = signedPayload(manifestPath);
      const payload = Buffer.from(manifest.payload, "base64url");
      expect(
        verify(
          "sha256",
          payload,
          createPublicKey(releaseKey.privateKey),
          Buffer.from(manifest.signature, "base64"),
        ),
      ).toBe(true);
      const descriptor = hostUpdateDescriptor(manifestPath);
      expect(descriptor.sequence).toBe(1);
      const relayTarget = descriptor.targets.find(({ platform }) => platform === "relay-linux-x86-64");
      expect(relayTarget?.artifactUrl.endsWith("/codewide-relay-x86_64-unknown-linux-musl.tar.gz")).toBe(true);
      expect(descriptor.targets).toHaveLength(3);
      expect(descriptor.targets.every(({ sourceRevision }) => sourceRevision.length === 40)).toBe(true);
      expect(descriptor.targets.every(({ sha256 }) => sha256.length === 64)).toBe(true);
      expect(descriptor.targets.every(({ rollbackCompatibleFrom }) => rollbackCompatibleFrom.length === 0)).toBe(true);
      const notes = readFileSync(join(paths.output, "release-notes.md"), "utf8");
      expect(notes).toContain("## Changes");
      expect(notes).toContain("## Downloads");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an altered product before making a release package", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root);
      writeFileSync(
        join(paths.artifacts, `CodeWide-Android-${version}`, "app-release.apk"),
        "altered APK",
      );
      expect(() =>
        prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing),
      ).toThrow("Invalid source checksum");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("carries unchanged versions, build provenance and the signed feed across multiple release sets", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-reused-release-"));
    try {
      const paths = fixture(root);
      prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing);
      const inventory = readReleaseProducts(
        JSON.parse(readFileSync(join(paths.output, "assets", "release-manifest.json"), "utf8")),
      );
      const nextArtifacts = join(root, "next-artifacts");
      const reused = join(nextArtifacts, "reused-products");
      mkdirSync(reused, { recursive: true });
      for (const product of inventory)
        for (const asset of product.assets) {
          copyFileSync(join(paths.output, "assets", asset.name), join(reused, asset.name));
        }
      const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const nextPlan = join(root, "next-plan.json");
      writeFileSync(
        nextPlan,
        JSON.stringify({
          base: sourceRevision,
          sourceRevision,
          tag: "release-2026-09-30.1",
          affected: [],
          targets: inventory.map((product) => ({
            ...product,
            previousVersion: product.version,
            delivery: "reuse",
          })),
        }),
      );
      const nextOutput = join(root, "next-output");
      prepareReleaseSet(nextPlan, nextArtifacts, nextOutput, signing);
      const products = readReleaseProducts(
        JSON.parse(readFileSync(join(nextOutput, "assets", "release-manifest.json"), "utf8")),
      );
      expect(products).toEqual(inventory);
      expect(readFileSync(join(nextOutput, "assets", "appcast.xml"))).toEqual(
        readFileSync(join(paths.output, "assets", "appcast.xml")),
      );
      expect(readFileSync(join(nextOutput, "release-notes.md"), "utf8")).toContain(
        `macos: ${version} (reuse`,
      );

      writeFileSync(
        nextPlan,
        JSON.stringify({
          base: sourceRevision,
          sourceRevision,
          tag: "release-2026-10-01.1",
          affected: [],
          targets: products.map((product) => ({
            ...product,
            previousVersion: product.version,
            delivery: "reuse",
          })),
        }),
      );
      const thirdOutput = join(root, "third-output");
      prepareReleaseSet(nextPlan, nextArtifacts, thirdOutput, signing);
      expect(
        readReleaseProducts(
          JSON.parse(readFileSync(join(thirdOutput, "assets", "release-manifest.json"), "utf8")),
        ),
      ).toEqual(inventory);

      writeFileSync(join(reused, `CodeWide-${version}.dmg`), "tampered original");
      expect(() => prepareReleaseSet(nextPlan, nextArtifacts, nextOutput, signing)).toThrow(
        "Reused asset checksum mismatch",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("assembles a dated inventory with one rebuilt product and three previous versions", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-mixed-release-"));
    try {
      const paths = fixture(root);
      prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing);
      const inventory = readReleaseProducts(
        JSON.parse(readFileSync(join(paths.output, "assets", "release-manifest.json"), "utf8")),
      );
      const reused = join(paths.artifacts, "reused-products");
      mkdirSync(reused);
      for (const product of inventory)
        for (const asset of product.assets) {
          copyFileSync(join(paths.output, "assets", asset.name), join(reused, asset.name));
        }
      const nextVersion = "0.5.0";
      const tag = "release-2026-09-30.2";
      const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      const android = join(paths.artifacts, `CodeWide-Android-${nextVersion}`);
      mkdirSync(android);
      writeFileSync(join(android, "app-release.apk"), "new Android");
      writeFileSync(
        join(android, "app-release.apk.sha256"),
        `${createHash("sha256").update("new Android").digest("hex")}  app-release.apk\n`,
      );
      writeFileSync(
        paths.planPath,
        JSON.stringify({
          base: sourceRevision,
          sourceRevision,
          tag,
          affected: ["android-apk"],
          targets: inventory.map((product) =>
            product.id === "android-apk"
              ? {
                  id: product.id,
                  delivery: "build",
                  version: nextVersion,
                  previousVersion: product.version,
                  sourceRevision,
                  sourceTag: tag,
                }
              : { ...product, previousVersion: product.version, delivery: "reuse" },
          ),
        }),
      );
      const nextOutput = join(root, "next");
      prepareReleaseSet(paths.planPath, paths.artifacts, nextOutput, signing);
      const products = readReleaseProducts(
        JSON.parse(readFileSync(join(nextOutput, "assets", "release-manifest.json"), "utf8")),
      );
      expect(products.filter(({ id }) => id !== "android-apk")).toEqual(
        inventory.filter(({ id }) => id !== "android-apk"),
      );
      expect(products.find(({ id }) => id === "android-apk")).toMatchObject({
        version: nextVersion,
        sourceTag: tag,
        sourceRevision,
      });
      expect(readFileSync(join(nextOutput, "assets", "CodeWide-0.5.0-500000.apk"), "utf8")).toBe(
        "new Android",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects Linux generation provenance that disagrees with the signed release plan", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root, { linuxSourceRevision: "b".repeat(40) });
      expect(() => prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing)).toThrow(
        "Linux Companion bundle provenance does not match the release plan",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a macOS feed that points outside the combined release", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root);
      writeFileSync(
        join(paths.artifacts, `CodeWide-${version}`, "appcast.xml"),
        '<enclosure url="https://github.com/MrFlashAccount/CodeWide/releases/download/v0.4.0/CodeWide-0.4.0.dmg" sparkle:edSignature="signature"/>',
      );
      expect(() =>
        prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, signing),
      ).toThrow("appcast does not point");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the signed update lineage when a later release reuses a product", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const baseline = fixture(join(root, "baseline"));
      prepareReleaseSet(baseline.planPath, baseline.artifacts, baseline.output, signing);
      const baselineManifestPath = join(baseline.output, "assets", "release-manifest.json");
      const next = fixture(join(root, "next"), { releaseVersion: "0.4.2" });
      prepareReleaseSet(next.planPath, next.artifacts, next.output, {
        ...signing,
        previousManifestPaths: [baselineManifestPath],
      });
      const nextManifestPath = join(next.output, "assets", "release-manifest.json");
      const reusedManifestPath = prepareReusedRelease(join(root, "reused"), next.output, [
        nextManifestPath,
      ]);

      const baselineTargets = hostUpdateTargets(baselineManifestPath);
      const reusedTargets = hostUpdateTargets(reusedManifestPath);
      for (const target of reusedTargets) {
        const baselineTarget = baselineTargets.find(({ platform }) => platform === target.platform);
        expect(target.rollbackCompatibleFrom).toEqual([baselineTarget?.sha256]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers a skipped official build from signed release history", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const baseline = fixture(join(root, "baseline"));
      prepareReleaseSet(baseline.planPath, baseline.artifacts, baseline.output, signing);
      const baselineManifestPath = join(baseline.output, "assets", "release-manifest.json");
      const next = fixture(join(root, "next"), { releaseVersion: "0.4.2" });
      prepareReleaseSet(next.planPath, next.artifacts, next.output, signing);
      const nextManifestPath = join(next.output, "assets", "release-manifest.json");
      // The later release was issued after the baseline without certifying it.
      resignWithSequence(nextManifestPath, 2);
      const reusedManifestPath = prepareReusedRelease(join(root, "reused"), next.output, [
        baselineManifestPath,
        nextManifestPath,
      ]);

      const baselineTargets = hostUpdateTargets(baselineManifestPath);
      for (const target of hostUpdateTargets(reusedManifestPath)) {
        const baselineTarget = baselineTargets.find(({ platform }) => platform === target.platform);
        expect(target.rollbackCompatibleFrom).toEqual([baselineTarget?.sha256]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("issues the next feed sequence after a predecessor whose sequence exceeds every product version", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      // release-2026-10-16.2 signed sequence 6000013 while its newest product was 0.6.12.
      const previous = fixture(join(root, "previous"), {
        releaseVersion: "0.6.12",
        previousVersion: "0.6.11",
      });
      prepareReleaseSet(previous.planPath, previous.artifacts, previous.output, signing);
      const previousManifestPath = join(previous.output, "assets", "release-manifest.json");
      resignWithSequence(previousManifestPath, 6_000_013);
      const next = fixture(join(root, "next"), {
        releaseVersion: "0.6.13",
        previousVersion: "0.6.12",
      });
      prepareReleaseSet(next.planPath, next.artifacts, next.output, {
        ...signing,
        previousManifestPaths: [previousManifestPath],
      });

      const descriptor = hostUpdateDescriptor(join(next.output, "assets", "release-manifest.json"));
      expect(descriptor.sequence).toBe(6_000_014);
      const previousTargets = hostUpdateTargets(previousManifestPath);
      for (const target of descriptor.targets) {
        const previousTarget = previousTargets.find(({ platform }) => platform === target.platform);
        expect(target.rollbackCompatibleFrom).toEqual([previousTarget?.sha256]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects predecessors that share a feed sequence", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const first = fixture(join(root, "first"));
      prepareReleaseSet(first.planPath, first.artifacts, first.output, signing);
      const second = fixture(join(root, "second"));
      prepareReleaseSet(second.planPath, second.artifacts, second.output, signing);
      const next = fixture(join(root, "next"), { releaseVersion: "0.4.2" });
      expect(() =>
        prepareReleaseSet(next.planPath, next.artifacts, next.output, {
          ...signing,
          previousManifestPaths: [
            join(first.output, "assets", "release-manifest.json"),
            join(second.output, "assets", "release-manifest.json"),
          ],
        }),
      ).toThrow("duplicate sequence");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a tampered predecessor instead of certifying rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const baseline = fixture(join(root, "baseline"));
      prepareReleaseSet(baseline.planPath, baseline.artifacts, baseline.output, signing);
      const previousManifestPath = join(baseline.output, "assets", "release-manifest.json");
      const envelopeValue: unknown = JSON.parse(readFileSync(previousManifestPath, "utf8"));
      if (!isRecord(envelopeValue) || typeof envelopeValue.payload !== "string") {
        throw new Error("Release manifest envelope is invalid");
      }
      const payload = `${envelopeValue.payload.startsWith("A") ? "B" : "A"}${envelopeValue.payload.slice(1)}`;
      writeFileSync(previousManifestPath, JSON.stringify({ ...envelopeValue, payload }));
      const next = fixture(join(root, "next"), { releaseVersion: "0.4.2" });
      expect(() =>
        prepareReleaseSet(next.planPath, next.artifacts, next.output, {
          ...signing,
          previousManifestPaths: [previousManifestPath],
        }),
      ).toThrow("Previous release manifest signature is invalid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a signing key that does not match the pinned public key", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root);
      expect(() =>
        prepareReleaseSet(paths.planPath, paths.artifacts, paths.output, {
          ...signing,
          publicKeySpki: Buffer.from("wrong key").toString("base64"),
        }),
      ).toThrow("does not match the pinned public SPKI");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
