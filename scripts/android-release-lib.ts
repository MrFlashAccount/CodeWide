export type AndroidReleaseVersion = {
  versionName: string;
  versionCode: number;
  runtimeVersion: string;
};

export type AndroidReleaseVersionPlan = {
  readonly requestedVersion: string | undefined;
  readonly requestedVersionCode: number | undefined;
};

export type ReleaseSourceFiles = {
  readonly appConfig: string;
  readonly gradle: string;
  readonly manifest: string;
};

type UpdatedReleaseSourceFiles = ReleaseSourceFiles & {
  previous: AndroidReleaseVersion;
  next: AndroidReleaseVersion;
};

export const ANDROID_PREVIEW_VERSION_NAME = "0.0.0.0";

const ANDROID_PREVIEW_VERSION_EPOCH_MS = Date.UTC(2026, 0, 1);
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

export function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null)
    throw new Error(`Android version must be MAJOR.MINOR.PATCH, received ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function readAndroidReleaseVersion(files: ReleaseSourceFiles): AndroidReleaseVersion {
  const app = parseAppConfig(files.appConfig);
  const gradleVersionName = capture(
    files.gradle,
    /def codewideVersionName = project\.findProperty\("codewideVersionName"\) \?: "([^"]+)"/u,
    "Gradle versionName",
  );
  const gradleVersionCode = Number(
    capture(
      files.gradle,
      /def codewideVersionCode = \(project\.findProperty\("codewideVersionCode"\) \?: "(\d+)"\)\.toInteger\(\)/u,
      "Gradle versionCode",
    ),
  );
  const manifestRuntime = capture(
    files.manifest,
    /android:name="expo\.modules\.updates\.EXPO_RUNTIME_VERSION" android:value="([^"]+)"/u,
    "manifest runtimeVersion",
  );

  if (
    app.versionName !== gradleVersionName ||
    app.versionCode !== gradleVersionCode ||
    app.runtimeVersion !== manifestRuntime
  ) {
    throw new Error(
      `Android release versions are inconsistent: app=${app.versionName}/${app.versionCode}/${app.runtimeVersion}, ` +
        `gradle=${gradleVersionName}/${gradleVersionCode}, manifest=${manifestRuntime}`,
    );
  }
  return app;
}

export function updateAndroidReleaseVersion(
  files: ReleaseSourceFiles,
  plan: AndroidReleaseVersionPlan,
): UpdatedReleaseSourceFiles {
  const previous = readAndroidReleaseVersion(files);
  const versionName = plan.requestedVersion ?? nextPatchVersion(previous.versionName);
  if (!/^\d+\.\d+\.\d+$/u.test(versionName))
    throw new Error(`Invalid Android version ${versionName}`);
  if (compareVersions(versionName, previous.versionName) <= 0) {
    throw new Error(
      `Android version must increase from ${previous.versionName}, received ${versionName}`,
    );
  }
  const versionCode = plan.requestedVersionCode ?? previous.versionCode + 1;
  validateAndroidVersionCode(versionCode);
  if (versionCode <= previous.versionCode) {
    throw new Error(
      `Android version code must increase from ${previous.versionCode}, received ${versionCode}`,
    );
  }
  return updateAndroidVersion(files, previous, {
    versionName,
    versionCode,
    runtimeVersion: `${versionName}-native-${versionCode}`,
  });
}

export function previewVersionCodeAt(timestampMs: number): number {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < ANDROID_PREVIEW_VERSION_EPOCH_MS) {
    throw new Error("Android preview build time must be on or after 2026-01-01");
  }
  const versionCode = Math.floor((timestampMs - ANDROID_PREVIEW_VERSION_EPOCH_MS) / 1_000) + 1;
  validateAndroidVersionCode(versionCode);
  return versionCode;
}

export function updateAndroidPreviewVersion(
  files: ReleaseSourceFiles,
  versionCode: number,
): UpdatedReleaseSourceFiles {
  validateAndroidVersionCode(versionCode);
  const previous = readAndroidReleaseVersion(files);
  return updateAndroidVersion(files, previous, {
    versionName: ANDROID_PREVIEW_VERSION_NAME,
    versionCode,
    runtimeVersion: `${ANDROID_PREVIEW_VERSION_NAME}-native-${versionCode}`,
  });
}

function updateAndroidVersion(
  files: ReleaseSourceFiles,
  previous: AndroidReleaseVersion,
  next: AndroidReleaseVersion,
): UpdatedReleaseSourceFiles {
  const parsed = JSON.parse(files.appConfig) as {
    expo?: { version?: unknown; runtimeVersion?: unknown; android?: { versionCode?: unknown } };
  };
  if (parsed.expo?.android === undefined)
    throw new Error("apps/android/app.json must define expo.android");
  parsed.expo.version = next.versionName;
  parsed.expo.runtimeVersion = next.runtimeVersion;
  parsed.expo.android.versionCode = next.versionCode;

  const gradle = replaceExactlyOnce(
    replaceExactlyOnce(
      files.gradle,
      /def codewideVersionCode = \(project\.findProperty\("codewideVersionCode"\) \?: "\d+"\)\.toInteger\(\)/u,
      `def codewideVersionCode = (project.findProperty("codewideVersionCode") ?: "${next.versionCode}").toInteger()`,
      "Gradle versionCode",
    ),
    /def codewideVersionName = project\.findProperty\("codewideVersionName"\) \?: "[^"]+"/u,
    `def codewideVersionName = project.findProperty("codewideVersionName") ?: "${next.versionName}"`,
    "Gradle versionName",
  );
  const manifest = replaceExactlyOnce(
    files.manifest,
    /android:name="expo\.modules\.updates\.EXPO_RUNTIME_VERSION" android:value="[^"]+"/u,
    `android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="${next.runtimeVersion}"`,
    "manifest runtimeVersion",
  );

  return {
    appConfig: `${JSON.stringify(parsed, null, 2)}\n`,
    gradle,
    manifest,
    previous,
    next,
  };
}

function validateAndroidVersionCode(versionCode: number): void {
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode > MAX_ANDROID_VERSION_CODE
  ) {
    throw new Error(
      `Android version code must be an integer from 1 to ${MAX_ANDROID_VERSION_CODE}, received ${versionCode}`,
    );
  }
}

function parseAppConfig(source: string): AndroidReleaseVersion {
  const parsed = JSON.parse(source) as {
    expo?: { version?: unknown; runtimeVersion?: unknown; android?: { versionCode?: unknown } };
  };
  const versionName = parsed.expo?.version;
  const runtimeVersion = parsed.expo?.runtimeVersion;
  const versionCode = parsed.expo?.android?.versionCode;
  if (
    typeof versionName !== "string" ||
    typeof runtimeVersion !== "string" ||
    !Number.isInteger(versionCode)
  ) {
    throw new Error(
      "apps/android/app.json must define version, runtimeVersion, and integer android.versionCode",
    );
  }
  return { versionName, runtimeVersion, versionCode: versionCode as number };
}

function capture(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) throw new Error(`Could not read ${label}`);
  return match[1];
}

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  replacement: string,
  label: string,
): string {
  const matches = source.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`));
  if (matches?.length !== 1)
    throw new Error(`Expected exactly one ${label}, found ${matches?.length ?? 0}`);
  return source.replace(pattern, replacement);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
