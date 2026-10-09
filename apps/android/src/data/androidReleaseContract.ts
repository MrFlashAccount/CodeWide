const STABLE_VERSION =
  /^(?<major>0|[1-9][0-9]*)\.(?<minor>0|[1-9][0-9]*)\.(?<patch>0|[1-9][0-9]*)$/u;

/** Public GitHub Release asset that inventories the latest CodeWide product versions. */
export const ANDROID_RELEASE_MANIFEST_URL =
  "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json";

const ANDROID_LATEST_RELEASE_URL = "https://github.com/MrFlashAccount/CodeWide/releases/latest";

/** Render-safe state published by the process-owned Android release check. */
export type AndroidReleaseAvailabilitySnapshot = {
  readonly latestVersion: string | null;
  readonly status: "error" | "idle" | "loading" | "ready";
};

/** Link presented when the release inventory contains a newer Android APK. */
export type AndroidReleaseUpdate = {
  readonly latestVersion: string;
  readonly releaseUrl: string;
};

/** Extracts the Android APK version from the public multi-product release inventory. */
export function parseAndroidReleaseVersion(value: unknown): string {
  const manifest = record(value, "release manifest");
  if (!Array.isArray(manifest.products)) {
    throw new Error("Release manifest products are required");
  }
  const matches = manifest.products.filter(
    (candidate) => record(candidate, "release product").id === "android-apk",
  );
  if (matches.length !== 1) {
    throw new Error("Release manifest must contain one Android APK product");
  }
  const product = record(matches[0], "Android APK product");
  const version = stableVersion(product.version, "Android APK version");
  if (
    !Array.isArray(product.assets) ||
    !product.assets.some((candidate) => {
      const asset = record(candidate, "Android APK asset");
      return typeof asset.name === "string" && asset.name.endsWith(".apk");
    })
  ) {
    throw new Error("Android APK product does not contain an APK asset");
  }
  return version;
}

/** Projects a newer stable APK version into the settings link; equal and older versions disappear. */
export function availableAndroidRelease(
  currentVersion: string,
  snapshot: AndroidReleaseAvailabilitySnapshot,
): AndroidReleaseUpdate | null {
  if (snapshot.latestVersion === null) {
    return null;
  }
  try {
    if (compareStableVersions(snapshot.latestVersion, currentVersion) <= 0) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    latestVersion: snapshot.latestVersion,
    releaseUrl: ANDROID_LATEST_RELEASE_URL,
  };
}

/** Validates one stable release version returned by the remote inventory. */
export function validateAndroidReleaseVersion(value: unknown): string {
  return stableVersion(value, "Android APK version");
}

function compareStableVersions(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = stableVersionParts(left);
  const [rightMajor, rightMinor, rightPatch] = stableVersionParts(right);
  const major = leftMajor - rightMajor;
  if (major !== 0) {
    return major;
  }
  const minor = leftMinor - rightMinor;
  if (minor !== 0) {
    return minor;
  }
  return leftPatch - rightPatch;
}

function stableVersion(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a stable semantic version`);
  }
  try {
    stableVersionParts(value);
  } catch {
    throw new Error(`${field} must be a stable semantic version`);
  }
  return value;
}

function stableVersionParts(version: string): readonly [number, number, number] {
  const groups = STABLE_VERSION.exec(version)?.groups;
  if (groups === undefined) {
    throw new Error("Release version must contain three components");
  }
  return [
    safeVersionComponent(groups.major),
    safeVersionComponent(groups.minor),
    safeVersionComponent(groups.patch),
  ];
}

function safeVersionComponent(value: string | undefined): number {
  const component = Number(value);
  if (!Number.isSafeInteger(component)) {
    throw new Error("Release version components must be safe integers");
  }
  return component;
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
