import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  deriveUpdateEndpoint,
  nextPatchVersion,
  readAndroidReleaseVersion,
  updateAndroidReleaseVersion,
} from "../../../scripts/android-release-lib";

const appConfig = readFileSync(new URL("../app.json", import.meta.url), "utf8");
const gradle = readFileSync(new URL("../android/app/build.gradle", import.meta.url), "utf8");
const manifest = readFileSync(
  new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
const packageJson = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
const otaPublisher = readFileSync(
  new URL("../../../scripts/publish-android-ota.ts", import.meta.url),
  "utf8",
);
const releaseAndroid = readFileSync(
  new URL("../../../scripts/release-android.ts", import.meta.url),
  "utf8",
);
const releaseApk = readFileSync(new URL("../../../scripts/release-apk", import.meta.url), "utf8");
const releaseOta = readFileSync(new URL("../../../scripts/release-ota", import.meta.url), "utf8");

const releaseWaitNotice =
  "This command may take a while. Do not report intermediate progress; wait silently until it finishes.";

describe("Android release automation", () => {
  it("derives the deployment endpoint from an existing OTA asset", () => {
    expect(
      deriveUpdateEndpoint("https://codex.garin.dev/api/updates/assets/runtime/update/index.hbc"),
    ).toBe("https://codex.garin.dev/api/updates");
  });

  it("increments the patch, native runtime, and version code atomically", () => {
    const current = readAndroidReleaseVersion({ appConfig, gradle, manifest });
    const updated = updateAndroidReleaseVersion({ appConfig, gradle, manifest });

    expect(updated.next).toEqual({
      versionName: nextPatchVersion(current.versionName),
      versionCode: current.versionCode + 1,
      runtimeVersion: `${nextPatchVersion(current.versionName)}-native-${current.versionCode + 1}`,
    });
    expect(readAndroidReleaseVersion(updated)).toEqual(updated.next);
    expect(() =>
      updateAndroidReleaseVersion({ appConfig, gradle, manifest }, current.versionName),
    ).toThrow(/must increase/u);
  });

  it("exposes one-shot OTA and APK commands", () => {
    expect(JSON.parse(packageJson).scripts).toMatchObject({
      "ota:publish": "tsx scripts/release-android.ts ota",
      "ota:publish:raw": "tsx scripts/publish-android-ota.ts",
      "release:ota": "tsx scripts/release-android.ts ota",
      "release:apk": "tsx scripts/release-android.ts apk",
    });
  });

  it("tells agents to wait silently before either release command starts", () => {
    for (const [script, command] of [
      [releaseApk, "exec pnpm release:apk"],
      [releaseOta, "exec pnpm release:ota"],
    ]) {
      const noticeIndex = script.indexOf(releaseWaitNotice);
      expect(noticeIndex).toBeGreaterThan(-1);
      expect(noticeIndex).toBeLessThan(script.indexOf(command));
    }
  });

  it("runs the authoritative V2 gate before either dry-run can return", () => {
    expect(releaseAndroid).toContain('await run("pnpm", ["validate:android:v2"]);');
    expect(releaseAndroid).toContain('await run("pnpm", ["validate:android:device-evidence"]);');
    expect(JSON.parse(packageJson).scripts["validate:android:device-evidence"]).toBe(
      "tsx scripts/validate-android-e2e-evidence.ts",
    );
    for (const functionName of ["releaseOta", "releaseApk"]) {
      const bodyStart = releaseAndroid.indexOf(`async function ${functionName}`);
      const nextFunction = releaseAndroid.indexOf("\nasync function ", bodyStart + 1);
      const body = releaseAndroid.slice(bodyStart, nextFunction);
      expect(body.indexOf("await runReleaseChecks();")).toBeGreaterThan(-1);
      expect(body.indexOf("await runReleaseChecks();")).toBeLessThan(body.indexOf("if (dryRun)"));
    }
  });

  it("does not ship Expo asset maps containing private build-machine paths", () => {
    expect(otaPublisher).not.toContain("--dump-assetmap");
  });
});
