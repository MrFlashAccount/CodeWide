import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { prepareReleaseSet } from "../../../scripts/prepare-release-set";

const version = "0.4.1";
const artifactFiles = [
  [`codewide-relay-${version}-linux-x86_64`, "codewide-relay-x86_64-unknown-linux-musl"],
  [`codewide-companion-${version}-linux-x86_64`, `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`],
  [`CodeWide-${version}`, `CodeWide-${version}.dmg`],
  [`CodeWide-${version}`, "appcast.xml"],
  [`CodeWide-Android-${version}`, "app-release.apk"],
] as const;

function fixture(root: string): { readonly planPath: string; readonly artifacts: string; readonly output: string } {
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const base = execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();
  const planPath = join(root, "plan.json");
  const artifacts = join(root, "artifacts");
  const output = join(root, "output");
  writeFileSync(planPath, JSON.stringify({
    base,
    sourceRevision,
    version,
    tag: `v${version}`,
    affected: ["android-apk"],
    targets: ["relay", "companion-linux", "macos", "android-apk"].map((id) => ({ id })),
  }));
  for (const [artifact, name] of artifactFiles) {
    const directory = join(artifacts, artifact);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    const content = name === "appcast.xml"
      ? `<enclosure url="https://github.com/MrFlashAccount/CodeWide/releases/download/v${version}/CodeWide-${version}.dmg" sparkle:edSignature="signature"/>`
      : `validated ${name}`;
    writeFileSync(path, content);
    if (name === "app-release.apk" || name.endsWith("-unknown-linux-musl") || name.endsWith(".tar.gz")) {
      const digest = createHash("sha256").update(content).digest("hex");
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
      prepareReleaseSet(paths.planPath, paths.artifacts, paths.output);
      const assets = join(paths.output, "assets");
      const sums = readFileSync(join(assets, "SHA256SUMS"), "utf8");
      expect(sums).toContain(`CodeWide-${version}-400001.apk`);
      expect(sums).toContain(`CodeWide-${version}.dmg`);
      expect(sums).toContain("appcast.xml");
      for (const name of ["codewide-relay-x86_64-unknown-linux-musl", `codewide-companion-${version}-x86_64-unknown-linux-musl.tar.gz`]) {
        const payload = readFileSync(join(assets, name));
        const digest = createHash("sha256").update(payload).digest("hex");
        expect(readFileSync(join(assets, `${name}.sha256`), "utf8")).toBe(`${digest}  ${name}\n`);
      }
      const manifest = readFileSync(join(assets, "release-manifest.json"), "utf8");
      expect(manifest).toContain('"sourceRevision"');
      expect(manifest).toContain('"sha256"');
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
      writeFileSync(join(paths.artifacts, `CodeWide-Android-${version}`, "app-release.apk"), "altered APK");
      expect(() => prepareReleaseSet(paths.planPath, paths.artifacts, paths.output)).toThrow("Invalid source checksum");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a macOS feed that points outside the combined release", () => {
    const root = mkdtempSync(join(tmpdir(), "codewide-release-"));
    try {
      const paths = fixture(root);
      writeFileSync(join(paths.artifacts, `CodeWide-${version}`, "appcast.xml"),
        '<enclosure url="https://github.com/MrFlashAccount/CodeWide/releases/download/v0.4.0/CodeWide-0.4.0.dmg" sparkle:edSignature="signature"/>');
      expect(() => prepareReleaseSet(paths.planPath, paths.artifacts, paths.output)).toThrow("appcast does not point");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
