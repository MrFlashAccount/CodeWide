import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createReleasePlan,
  parseGitNameStatus,
  parseReleaseGraph,
} from "../../../scripts/release-plan";

const graph = parseReleaseGraph(
  readFileSync(new URL("../../../release/graph.json", import.meta.url), "utf8"),
);

function targets(files: readonly string[]): readonly string[] {
  return createReleasePlan(graph, files).targets.map(({ id }) => id);
}

describe("release graph", () => {
  it("releases both platform hosts when shared Companion core changes", () => {
    expect(targets(["crates/companion-core/src/runtime_host.rs"])).toEqual([
      "macos",
      "companion-linux",
    ]);
  });

  it("releases only macOS for a native menu app change", () => {
    expect(targets(["apps/macos/Sources/CodeWide/CodeWideApp.swift"])).toEqual(["macos"]);
  });

  it("selects OTA for JavaScript-only Android changes", () => {
    expect(targets(["apps/android/src/ui/Button.tsx"])).toEqual(["android-ota"]);
  });

  it("lets an APK supersede OTA when native and JavaScript code both change", () => {
    expect(
      targets([
        "apps/android/src/ui/Button.tsx",
        "apps/android/android/app/src/main/java/dev/codewide/app/MainApplication.kt",
      ]),
    ).toEqual(["android-apk"]);
  });

  it("propagates package dependency changes to Android OTA", () => {
    expect(targets(["packages/domain/src/index.ts"])).toEqual(["android-ota"]);
  });

  it("treats lockfile changes conservatively as native Android releases", () => {
    expect(targets(["pnpm-lock.yaml"])).toEqual(["android-apk"]);
  });

  it("does not release artifacts for documentation-only changes", () => {
    const plan = createReleasePlan(graph, [
      "docs/macos-companion.md",
      "crates/companion-core/README.md",
      "crates/companion-swift-ffi/README.md",
      "apps/companion/README.md",
      "apps/relay/README.md",
    ]);
    expect(plan.targets).toEqual([]);
    expect(plan.unmatchedFiles).toEqual([]);
  });

  it("reports uncovered source paths instead of silently declaring no release", () => {
    const plan = createReleasePlan(graph, ["tools/new-runtime/main.go"]);
    expect(plan.targets).toEqual([]);
    expect(plan.unmatchedFiles).toEqual(["tools/new-runtime/main.go"]);
  });

  it("keeps both sides of a rename in the affected calculation", () => {
    expect(
      parseGitNameStatus("R100\0crates/companion-core/src/old.rs\0docs/old.rs\0"),
    ).toEqual(["crates/companion-core/src/old.rs", "docs/old.rs"]);
  });

  it("rejects dependency cycles", () => {
    expect(() =>
      parseReleaseGraph(
        JSON.stringify({
          version: 1,
          components: [
            { id: "a", paths: ["a/"], dependsOn: ["b"] },
            { id: "b", paths: ["b/"], dependsOn: ["a"] },
          ],
          targets: [],
        }),
      ),
    ).toThrow(/cycle/u);
  });
});
