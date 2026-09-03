import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };
const androidPackageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };
const androidBundleGate = readFileSync(
  new URL("../../../scripts/validate-android-v2-bundle.sh", import.meta.url),
  "utf8",
);
const syncGate = readFileSync(
  new URL("../../../scripts/validate-sync-v2.sh", import.meta.url),
  "utf8",
);
const companionBuild = readFileSync(
  new URL("../../../scripts/build-companion.sh", import.meta.url),
  "utf8",
);
const companionRelease = readFileSync(
  new URL("../../../scripts/release-companion", import.meta.url),
  "utf8",
);
const renderConfig = readFileSync(new URL("../jest.v2.config.cjs", import.meta.url), "utf8");
const renderConsoleSetup = readFileSync(
  new URL("./setup-v2-render-console.cjs", import.meta.url),
  "utf8",
);
const knipConfig = readFileSync(new URL("../knip.v2.config.mjs", import.meta.url), "utf8");
const androidTests = readdirSync(new URL("./", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => /^(?:sync-v2|v2)/u.test(name));
const syncClientTests = readdirSync(
  new URL("../../../packages/sync-client/test/", import.meta.url),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && /^v2-.*\.test\.ts$/u.test(entry.name))
  .map((entry) => new URL(`../../../packages/sync-client/test/${entry.name}`, import.meta.url));
const companionIntegrationTests = readdirSync(
  new URL("../../../apps/companion/tests/", import.meta.url),
  { withFileTypes: true },
)
  .filter((entry) => entry.isFile() && /^(?:live_v2|v2_).*\.rs$/u.test(entry.name))
  .map((entry) => new URL(`../../../apps/companion/tests/${entry.name}`, import.meta.url));
describe("V2 validation gates", () => {
  it("discovers every V2 protocol and Companion test family", () => {
    const command = packageJson.scripts["validate:sync:v2"] ?? "";

    expect(command).toBe("sh ./scripts/validate-sync-v2.sh");
    expect(syncGate).toContain("packages/sync-client/test/v2-*.test.ts");
    expect(syncGate).toContain("cargo test -p codewide-companion sync_v2 --lib");
    expect(syncGate).toContain('"$repo_root"/apps/companion/tests/v2_*.rs');
    expect(syncGate).toContain('"$repo_root"/apps/companion/tests/live_v2*.rs');
    expect(syncGate).toContain('cargo test -p codewide-companion --test "$target"');
    expect(syncGate).toContain("export CARGO_INCREMENTAL=0");
    expect(syncGate).not.toContain("--ignored");
  });

  it("discovers V2 Android unit, render, and every native unit test", () => {
    const command = packageJson.scripts["validate:android:v2"] ?? "";

    expect(command).toContain("apps/android/test/sync-v2*.test.ts");
    expect(command).toContain("apps/android/test/v2*.test.ts");
    for (const infrastructureSuite of [
      "android-e2e-source-fingerprint.test.ts",
      "android-release-automation.test.ts",
      "companion-transport-security.test.ts",
      "native-app-config.test.ts",
      "native-voice-e2e-fault.test.ts",
      "release-dry-run-execution.test.ts",
    ]) {
      expect(command).toContain(`apps/android/test/${infrastructureSuite}`);
    }
    expect(command).toContain("test:v2:render");
    expect(command).toContain("compile:v2:android");
    expect(command).toContain(":app:testDebugUnitTest");
    expect(command).not.toContain("--tests");
    expect(renderConfig).toContain("<rootDir>/test/**/*.render.test.tsx");
    expect(renderConfig).toContain("<rootDir>/test/setup-v2-render-console.cjs");
    expect(renderConsoleSetup).toContain('jest.spyOn(console, "error")');
    expect(renderConsoleSetup).toContain("Unexpected console.error in V2 render test");
    expect(
      androidTests.filter(
        (name) => !name.endsWith(".test.ts") && !name.endsWith(".render.test.tsx"),
      ),
    ).toStrictEqual([]);
  });

  it("compiles the production Android Metro graph without publishing", () => {
    expect(androidPackageJson.scripts["compile:v2:android"]).toBe(
      "sh ../../scripts/validate-android-v2-bundle.sh",
    );
    expect(androidBundleGate).toContain("expo export:embed");
    expect(androidBundleGate).toContain("NODE_ENV=production");
    expect(androidBundleGate).toContain("--platform android");
    expect(androidBundleGate).toContain("--dev false");
    expect(androidBundleGate).toContain("--unstable-transform-profile hermes");
    expect(androidBundleGate).toContain("mktemp -d");
    expect(androidBundleGate).not.toMatch(/expo\s+(?:publish|update)/u);
  });

  it("keeps V2 suites executable and barrier-driven", () => {
    const v2TestSources = [
      ...androidTests.map((name) => new URL(`./${name}`, import.meta.url)),
      ...syncClientTests,
      ...companionIntegrationTests,
    ];
    const focusedOrSkippedTest = /\b(?:describe|it|test)\.(?:only|skip|todo)\b/u;
    const wallClockSleep = /(?:setTimeout\s*\(|thread::sleep\s*\(|tokio::time::sleep\s*\()/u;
    const violations = v2TestSources.flatMap((url) => {
      const source = readFileSync(url, "utf8");
      return [
        ...(focusedOrSkippedTest.test(source) ? [`${url.pathname}: focused or skipped test`] : []),
        ...(wallClockSleep.test(source) ? [`${url.pathname}: wall-clock sleep`] : []),
      ];
    });

    expect(violations).toStrictEqual([]);
  });

  it("keeps managed App Server tests explicit and opt-in", () => {
    const command = packageJson.scripts["validate:sync:v2:managed-live"] ?? "";
    expect(command).toContain("CODEWIDE_LIVE_E2E=1");
    expect(command).toContain("--test live_v2_backend_contract -- --ignored");
  });

  it("disables incremental Rust compilation in validation and release scripts", () => {
    expect(packageJson.scripts["test:companion"]).toContain("CARGO_INCREMENTAL=0");
    expect(packageJson.scripts["bench:large-content"]).toContain("CARGO_INCREMENTAL=0");
    expect(packageJson.scripts["release:gate"]).toContain("CARGO_INCREMENTAL=0");
    expect(syncGate).toContain("export CARGO_INCREMENTAL=0");
    expect(companionBuild).toContain("export CARGO_INCREMENTAL=0");
    expect(companionRelease).toContain("CARGO_INCREMENTAL=0 cargo clippy");
    expect(companionRelease).toContain("CARGO_INCREMENTAL=0 cargo test");
  });

  it("starts Knip from real runtime roots instead of treating all V2 source as reachable", () => {
    const entrySection = knipConfig.slice(
      knipConfig.indexOf("  entry: ["),
      knipConfig.indexOf("  project: ["),
    );

    expect(androidPackageJson.scripts["lint:v2:dead-code"]).toContain(
      "--config knip.v2.config.mjs",
    );
    expect(entrySection).toContain('"src/v2/V2Application.tsx"');
    expect(entrySection).not.toMatch(/src\/(?:boot|presentation|v2)\/\*\*/u);
    expect(knipConfig).not.toContain("ignoreIssues");
  });
});
