import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
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

describe("Android release automation", () => {
  it("increments the patch, native runtime, and version code atomically", () => {
    const current = readAndroidReleaseVersion({ appConfig, gradle, manifest });
    const updated = updateAndroidReleaseVersion(
      { appConfig, gradle, manifest },
      { requestedVersion: undefined, requestedVersionCode: undefined },
    );

    expect(updated.next).toEqual({
      versionName: nextPatchVersion(current.versionName),
      versionCode: current.versionCode + 1,
      runtimeVersion: `${nextPatchVersion(current.versionName)}-native-${current.versionCode + 1}`,
    });
    expect(readAndroidReleaseVersion(updated)).toEqual(updated.next);
    expect(() =>
      updateAndroidReleaseVersion(
        { appConfig, gradle, manifest },
        { requestedVersion: current.versionName, requestedVersionCode: undefined },
      ),
    ).toThrow(/must increase/u);
  });

  it("accepts a CI-owned monotonic version code without weakening version checks", () => {
    const current = readAndroidReleaseVersion({ appConfig, gradle, manifest });
    const requestedVersionCode = current.versionCode + 100_000;
    const updated = updateAndroidReleaseVersion(
      { appConfig, gradle, manifest },
      {
        requestedVersion: nextPatchVersion(current.versionName),
        requestedVersionCode,
      },
    );

    expect(updated.next.versionCode).toBe(requestedVersionCode);
    expect(updated.next.runtimeVersion).toBe(
      `${updated.next.versionName}-native-${requestedVersionCode}`,
    );
    expect(() =>
      updateAndroidReleaseVersion(
        { appConfig, gradle, manifest },
        {
          requestedVersion: nextPatchVersion(current.versionName),
          requestedVersionCode: current.versionCode,
        },
      ),
    ).toThrow(/version code must increase/u);
  });
});
