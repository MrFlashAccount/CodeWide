import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bumpVersion } from "../../../scripts/release-set-plan";

const repoRoot = new URL("../../..", import.meta.url);
const planner = new URL("../../../scripts/release-set-plan.ts", import.meta.url);

type Target = {
  readonly id: string;
  readonly version: string;
  readonly delivery: string;
};

type Plan = {
  readonly tag: string;
  readonly affected: readonly string[];
  readonly targets: readonly Target[];
};

function plan(files: readonly string[], bump = "patch", androidVersion = "0.4.0"): Plan {
  const root = mkdtempSync(join(tmpdir(), "codewide-release-inventory-"));
  const manifest = join(root, "manifest.json");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  writeFileSync(
    manifest,
    JSON.stringify({
      tag: "release-2026-09-29.1",
      sourceRevision: revision,
      products: ["relay", "companion-linux", "macos", "android-apk"].map((id) => ({
        id,
        version: id === "android-apk" ? androidVersion : "0.4.0",
        sourceRevision: revision,
        sourceTag: "v0.4.0",
        assets: [{ name: `${id}.artifact`, sha256: "b".repeat(64), size: 1 }],
      })),
    }),
  );
  try {
    const output = execFileSync(
      process.execPath,
      [
        planner.pathname,
        "--files",
        files.join(","),
        "--bump",
        bump,
        "--previous-manifest",
        manifest,
        "--date",
        "2026-09-30",
        "--json",
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const value: unknown = JSON.parse(output);
    if (
      !isRecord(value) ||
      !Array.isArray(value.targets) ||
      typeof value.tag !== "string" ||
      !Array.isArray(value.affected)
    ) {
      throw new Error("release-set plan is invalid");
    }
    const targets = value.targets.map((target) => {
      if (
        !isRecord(target) ||
        typeof target.id !== "string" ||
        typeof target.version !== "string" ||
        typeof target.delivery !== "string"
      ) {
        throw new Error("release-set target is invalid");
      }
      return { id: target.id, version: target.version, delivery: target.delivery };
    });
    return { tag: value.tag, affected: value.affected, targets };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("release-set planner", () => {
  it("bumps a product's semantic version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("rebuilds platform hosts and reuses unchanged products when shared core changes", () => {
    const result = plan(["crates/companion-core/src/runtime_host.rs"]);
    expect(result.affected).toEqual(["companion-linux", "macos"]);
    expect(result.targets).toEqual([
      { id: "relay", version: "0.4.0", delivery: "reuse" },
      { id: "companion-linux", version: "0.4.1", delivery: "build" },
      { id: "macos", version: "0.4.1", delivery: "build" },
      { id: "android-apk", version: "0.4.0", delivery: "reuse" },
    ]);
  });

  it("builds only Android and keeps the other products' published versions", () => {
    const result = plan(["apps/android/src/ui/Button.tsx"]);
    expect(result.affected).toEqual(["android-apk"]);
    expect(result.targets).toHaveLength(4);
    expect(result.targets.filter(({ delivery }) => delivery === "build")).toEqual([
      { id: "android-apk", version: "0.4.1", delivery: "build" },
    ]);
    expect(
      result.targets.filter(({ delivery }) => delivery === "reuse").map(({ version }) => version),
    ).toEqual(["0.4.0", "0.4.0", "0.4.0"]);
    expect(result.tag).toMatch(/^release-2026-09-30\.[1-9][0-9]*$/u);
  });

  it("publishes orchestration changes without pretending product binaries changed", () => {
    const result = plan([".github/workflows/release-set.yml"]);
    expect(result.affected).toEqual([]);
    expect(result.targets).toHaveLength(4);
    expect(
      result.targets.every(({ delivery, version }) => delivery === "reuse" && version === "0.4.0"),
    ).toBe(true);
  });

  it("increments each changed product from its own version, not the newest sibling", () => {
    const result = plan(["crates/companion-core/src/runtime_host.rs"], "patch", "0.8.2");
    expect(result.targets).toEqual([
      { id: "relay", version: "0.4.0", delivery: "reuse" },
      { id: "companion-linux", version: "0.4.1", delivery: "build" },
      { id: "macos", version: "0.4.1", delivery: "build" },
      { id: "android-apk", version: "0.8.2", delivery: "reuse" },
    ]);
  });

  it("does not publish documentation-only changes", () => {
    expect(plan(["docs/release-process.md"]).targets).toEqual([]);
  });
});
