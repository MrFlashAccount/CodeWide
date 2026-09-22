import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { parseGitNameStatus } from "../../../scripts/release-plan";

const repoRoot = new URL("../../..", import.meta.url);
const planner = new URL("../../../scripts/release-plan.ts", import.meta.url);

type Plan = {
  readonly affectedProjects: readonly string[];
  readonly targets: readonly { readonly id: string }[];
};

function plan(files: readonly string[]): Plan {
  const output = execFileSync(
    process.execPath,
    [planner.pathname, "--files", files.join(","), "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const value: unknown = JSON.parse(output);
  if (!isRecord(value) || !Array.isArray(value.affectedProjects) || !Array.isArray(value.targets)) {
    throw new Error("release plan output is invalid");
  }
  if (value.affectedProjects.some((project) => typeof project !== "string")) {
    throw new Error("release plan affectedProjects is invalid");
  }
  const targets = value.targets.map((target) => {
    if (!isRecord(target) || typeof target.id !== "string") {
      throw new Error("release plan target is invalid");
    }
    return { id: target.id };
  });
  return { affectedProjects: value.affectedProjects, targets };
}

function targetIds(files: readonly string[]): readonly string[] {
  return plan(files).targets.map(({ id }) => id);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("Nx release graph", () => {
  it("releases both platform hosts when shared Companion core changes", () => {
    expect(targetIds(["crates/companion-core/src/runtime_host.rs"])).toEqual([
      "companion-linux",
      "macos",
    ]);
  });

  it("releases only macOS for a native menu app change", () => {
    expect(targetIds(["apps/companion-macos/Sources/CodeWide/CodeWideApp.swift"])).toEqual(["macos"]);
  });

  it("keeps the current Relay coupling conservative until its adapter is split", () => {
    expect(targetIds(["apps/relay/src/lib.rs"])).toEqual([
      "relay",
      "companion-linux",
      "macos",
    ]);
  });

  it("releases an APK for JavaScript-only Android changes", () => {
    expect(targetIds(["apps/android/src/ui/Button.tsx"])).toEqual(["android-apk"]);
  });

  it("releases an APK for native Android changes", () => {
    expect(
      targetIds(["apps/android/android/app/src/main/java/dev/codewide/app/MainApplication.kt"]),
    ).toEqual(["android-apk"]);
  });

  it("propagates TypeScript package changes to the Android APK", () => {
    expect(targetIds(["packages/domain/src/index.ts"])).toEqual(["android-apk"]);
  });

  it("propagates the shared sync contract to both Companion hosts and Android", () => {
    expect(targetIds(["crates/companion-core/contract/v2.json"])).toEqual([
      "companion-linux",
      "macos",
      "android-apk",
    ]);
  });

  it("releases every linked product when the compatibility contract changes", () => {
    expect(targetIds(["release/compatibility.json"])).toEqual([
      "relay",
      "companion-linux",
      "macos",
      "android-apk",
    ]);
  });

  it("does not release artifacts for documentation-only changes", () => {
    expect(
      targetIds(["docs/macos-companion.md", "apps/companion-macos/README.md"]),
    ).toEqual([]);
  });

  it("does not release artifacts for test-only changes", () => {
    expect(
      targetIds([
        "apps/android/test/navigation.test.ts",
        "crates/companion-core/src/sync_v2/protocol/tests.rs",
      ]),
    ).toEqual([]);
  });

  it("keeps both sides of a rename in the affected calculation", () => {
    expect(
      parseGitNameStatus("R100\0crates/companion-core/src/old.rs\0docs/old.rs\0"),
    ).toEqual(["crates/companion-core/src/old.rs", "docs/old.rs"]);
  });
});
