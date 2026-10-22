import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ANDROID_PREVIEW_VERSION_NAME,
  nextPatchVersion,
  previewVersionCodeAt,
  readAndroidReleaseVersion,
  updateAndroidPreviewVersion,
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

  it("keeps preview versionName fixed while versionCode orders installations", () => {
    const epoch = Date.UTC(2026, 0, 1);
    expect(previewVersionCodeAt(epoch)).toBe(1);
    expect(previewVersionCodeAt(epoch + 12_345)).toBe(13);

    const updated = updateAndroidPreviewVersion({ appConfig, gradle, manifest }, 42);
    expect(updated.next).toEqual({
      versionName: ANDROID_PREVIEW_VERSION_NAME,
      versionCode: 42,
      runtimeVersion: `${ANDROID_PREVIEW_VERSION_NAME}-native-42`,
    });
    expect(readAndroidReleaseVersion(updated)).toEqual(updated.next);
    expect(() => updateAndroidPreviewVersion({ appConfig, gradle, manifest }, 0)).toThrow(
      /integer from 1/u,
    );
    expect(() =>
      updateAndroidPreviewVersion({ appConfig, gradle, manifest }, 2_100_000_001),
    ).toThrow(/integer from 1/u);
  });
});
