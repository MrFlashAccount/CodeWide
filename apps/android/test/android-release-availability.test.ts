import { describe, expect, it } from "vitest";

import {
  availableAndroidRelease,
  parseAndroidReleaseVersion,
} from "../src/data/androidReleaseContract";

function manifest(version = "0.5.0") {
  return {
    products: [
      {
        assets: [{ name: `CodeWide-${version}-500000.apk` }],
        id: "android-apk",
        version,
      },
    ],
  };
}

describe("Android release availability", () => {
  it("reads the stable Android APK version from the release inventory", () => {
    expect(parseAndroidReleaseVersion(manifest())).toBe("0.5.0");
    expect(() => parseAndroidReleaseVersion({ products: [] })).toThrow(/one Android APK/u);
    expect(() => parseAndroidReleaseVersion(manifest("0.5.0-beta.1"))).toThrow(/stable semantic/u);
  });

  it("offers only a strictly newer APK version", () => {
    expect(
      availableAndroidRelease("0.2.231", { latestVersion: "0.5.0", status: "ready" }),
    ).toMatchObject({ latestVersion: "0.5.0" });
    expect(
      availableAndroidRelease("0.5.0", { latestVersion: "0.5.0", status: "ready" }),
    ).toBeNull();
    expect(
      availableAndroidRelease("0.6.0", { latestVersion: "0.5.0", status: "ready" }),
    ).toBeNull();
    expect(
      availableAndroidRelease("unknown", { latestVersion: "0.5.0", status: "ready" }),
    ).toBeNull();
  });
});
