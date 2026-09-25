import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { bumpVersion } from "../../../scripts/release-set-plan";

const repoRoot = new URL("../../..", import.meta.url);
const planner = new URL("../../../scripts/release-set-plan.ts", import.meta.url);

type Target = {
  readonly id: string;
  readonly version: string;
};

type Plan = {
  readonly tag: string;
  readonly affected: readonly string[];
  readonly targets: readonly Target[];
};

function plan(files: readonly string[], bump = "patch"): Plan {
  const output = execFileSync(
    process.execPath,
    [planner.pathname, "--files", files.join(","), "--bump", bump, "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const value: unknown = JSON.parse(output);
  if (!isRecord(value) || !Array.isArray(value.targets) || typeof value.tag !== "string" || !Array.isArray(value.affected)) {
    throw new Error("release-set plan is invalid");
  }
  const targets = value.targets.map((target) => {
    if (!isRecord(target) || typeof target.id !== "string" || typeof target.version !== "string") {
      throw new Error("release-set target is invalid");
    }
    return { id: target.id, version: target.version };
  });
  return { tag: value.tag, affected: value.affected, targets };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("release-set planner", () => {
  it("bumps the shared semantic release version", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("includes the complete release set when shared core changes", () => {
    const result = plan(["crates/companion-core/src/runtime_host.rs"]);
    expect(result.affected).toEqual(["companion-linux", "macos"]);
    expect(result.targets).toEqual([
      { id: "relay", version: result.tag.slice(1) },
      { id: "companion-linux", version: result.tag.slice(1) },
      { id: "macos", version: result.tag.slice(1) },
      { id: "android-apk", version: result.tag.slice(1) },
    ]);
  });

  it("includes all release assets when only Android changes", () => {
    const result = plan(["apps/android/src/ui/Button.tsx"]);
    expect(result.affected).toEqual(["android-apk"]);
    expect(result.targets).toHaveLength(4);
    expect(new Set(result.targets.map(({ version }) => version))).toEqual(new Set([result.tag.slice(1)]));
  });

  it("releases the new pipeline itself after a workflow change", () => {
    const result = plan([".github/workflows/release-set.yml"]);
    expect(result.affected).toEqual(["relay", "companion-linux", "macos", "android-apk"]);
    expect(result.targets).toHaveLength(4);
  });

  it("does not publish documentation-only changes", () => {
    expect(plan(["docs/release-process.md"]).targets).toEqual([]);
  });
});
