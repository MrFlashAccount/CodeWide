import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { bumpVersion } from "../../../scripts/release-set-plan";

const repoRoot = new URL("../../..", import.meta.url);
const planner = new URL("../../../scripts/release-set-plan.ts", import.meta.url);

type Target = {
  readonly id: string;
  readonly version: string;
};

function targets(files: readonly string[], bump = "patch"): readonly Target[] {
  const output = execFileSync(
    process.execPath,
    [planner.pathname, "--files", files.join(","), "--bump", bump, "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const value: unknown = JSON.parse(output);
  if (!isRecord(value) || !Array.isArray(value.targets)) throw new Error("release-set plan is invalid");
  return value.targets.map((target) => {
    if (!isRecord(target) || typeof target.id !== "string" || typeof target.version !== "string") {
      throw new Error("release-set target is invalid");
    }
    return { id: target.id, version: target.version };
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("release-set planner", () => {
  it("bumps semantic versions without coupling product release numbers", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("plans shared core consumers from their own baselines", () => {
    expect(targets(["crates/companion-core/src/runtime_host.rs"])).toEqual([
      { id: "companion-linux", version: "0.1.1" },
      { id: "macos", version: "0.2.1" },
    ]);
  });

  it("plans a native Android APK from the current Android baseline", () => {
    expect(targets(["apps/android/src/ui/Button.tsx"])).toEqual([
      { id: "android-apk", version: "0.2.177" },
    ]);
  });
});
