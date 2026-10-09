import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
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
function artifactFiles(releaseVersion: string) {
  return [
    [`codewide-relay-${releaseVersion}-linux-x86_64`, "codewide-relay-x86_64-unknown-linux-musl"],
    [`codewide-relay-${releaseVersion}-linux-x86_64`, "codewide-relay-updater-x86_64-unknown-linux-musl"],
    [
      `codewide-companion-${releaseVersion}-linux-x86_64`,
      `codewide-companion-${releaseVersion}-x86_64-unknown-linux-musl.tar.gz`,
    ],
    [`CodeWide-${releaseVersion}`, `CodeWide-${releaseVersion}.dmg`],
    [`CodeWide-${releaseVersion}`, "appcast.xml"],
    [`CodeWide-Android-${releaseVersion}`, "app-release.apk"],
  ] as const;
}

function fixture(
  root: string,
  releaseVersion = version,
  linuxSourceRevision?: string,
): { readonly planPath: string; readonly artifacts: string; readonly output: string } {
  mkdirSync(root, { recursive: true });
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const base = execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();
  const planPath = join(root, "plan.json");
  const artifacts = join(root, "artifacts");
  const output = join(root, "output");
  const previousVersion = releaseVersion === version ? "0.4.0" : version;
  writeFileSync(planPath, JSON.stringify({
    base,
    sourceRevision,
    version: releaseVersion,
    previousVersion,
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

describe("atomic release package", () => {
  it("stages all products with verifiable checksums and human-readable notes", () => {
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
        "codewide-relay-updater-x86_64-unknown-linux-musl",
        `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`,
      ]) {
        const payload = readFileSync(join(assets, name));
        const digest = createHash("sha256").update(payload).digest("hex");
        expect(readFileSync(join(assets, `${name}.sha256`), "utf8")).toBe(`${digest}  ${name}\n`);
      }
      const manifest = JSON.parse(readFileSync(join(assets, "release-manifest.json"), "utf8")) as {
        readonly payload: string;
        readonly signature: string;
      };
      const payload = Buffer.from(manifest.payload, "base64url");
      expect(
        verify(
          "sha256",
          payload,
          createPublicKey(releaseKey.privateKey),
          Buffer.from(manifest.signature, "base64"),
        ),
      ).toBe(true);
      const descriptor = JSON.parse(payload.toString("utf8")) as {
        readonly sequence: number;
        readonly targets: readonly {
          readonly sourceRevision: string;
          readonly sha256: string;
          readonly rollbackCompatibleFrom: readonly string[];
        }[];
      };
      expect(descriptor.sequence).toBe(4_000_001);
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
          version: "0.5.0",
          previousVersion: version,
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
          version: "0.5.0",
          previousVersion: version,
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
          version: nextVersion,
          previousVersion: version,
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
      const paths = fixture(root, version, "b".repeat(40));
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

  it("certifies only digests from the verified immediate predecessor", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const baseline = fixture(join(root, "baseline"));
      prepareReleaseSet(baseline.planPath, baseline.artifacts, baseline.output, signing);
      const previousManifestPath = join(baseline.output, "assets", "release-manifest.json");
      const next = fixture(join(root, "next"), "0.4.2");
      prepareReleaseSet(next.planPath, next.artifacts, next.output, {
        ...signing,
        previousManifestPath,
      });
      const previousEnvelope = JSON.parse(readFileSync(previousManifestPath, "utf8")) as {
        readonly payload: string;
      };
      const previousDescriptor = JSON.parse(
        Buffer.from(previousEnvelope.payload, "base64url").toString("utf8"),
      ) as {
        readonly targets: readonly { readonly platform: string; readonly sha256: string }[];
      };
      const nextEnvelope = JSON.parse(
        readFileSync(join(next.output, "assets", "release-manifest.json"), "utf8"),
      ) as { readonly payload: string };
      const nextDescriptor = JSON.parse(
        Buffer.from(nextEnvelope.payload, "base64url").toString("utf8"),
      ) as {
        readonly targets: readonly {
          readonly platform: string;
          readonly rollbackCompatibleFrom: readonly string[];
        }[];
      };
      for (const target of nextDescriptor.targets) {
        const previous = previousDescriptor.targets.find(({ platform }) => platform === target.platform);
        expect(target.rollbackCompatibleFrom).toEqual([previous?.sha256]);
      }
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
      const envelope = JSON.parse(readFileSync(previousManifestPath, "utf8")) as { payload: string };
      envelope.payload = `${envelope.payload.startsWith("A") ? "B" : "A"}${envelope.payload.slice(1)}`;
      writeFileSync(previousManifestPath, JSON.stringify(envelope));
      const next = fixture(join(root, "next"), "0.4.2");
      expect(() =>
        prepareReleaseSet(next.planPath, next.artifacts, next.output, {
          ...signing,
          previousManifestPath,
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
