export type AndroidReleaseVersion = {
  versionName: string;
  versionCode: number;
  runtimeVersion: string;
};

type ReleaseSourceFiles = {
  appConfig: string;
  gradle: string;
  manifest: string;
};

type UpdatedReleaseSourceFiles = ReleaseSourceFiles & {
  previous: AndroidReleaseVersion;
  next: AndroidReleaseVersion;
};

export function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (match === null) throw new Error(`Android version must be MAJOR.MINOR.PATCH, received ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

export function deriveUpdateEndpoint(assetUrl: string): string {
  const url = new URL(assetUrl);
  const marker = "/assets/";
  const markerIndex = url.pathname.indexOf(marker);
  if (url.protocol !== "https:" || markerIndex === -1) {
    throw new Error(`Could not derive an HTTPS Expo Updates endpoint from ${assetUrl}`);
  }
  url.pathname = url.pathname.slice(0, markerIndex);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function readAndroidReleaseVersion(files: ReleaseSourceFiles): AndroidReleaseVersion {
  const app = parseAppConfig(files.appConfig);
  const gradleVersionName = capture(files.gradle, /def codewideVersionName = project\.findProperty\("codewideVersionName"\) \?: "([^"]+)"/u, "Gradle versionName");
  const gradleVersionCode = Number(capture(files.gradle, /def codewideVersionCode = \(project\.findProperty\("codewideVersionCode"\) \?: "(\d+)"\)\.toInteger\(\)/u, "Gradle versionCode"));
  const manifestRuntime = capture(files.manifest, /android:name="expo\.modules\.updates\.EXPO_RUNTIME_VERSION" android:value="([^"]+)"/u, "manifest runtimeVersion");

  if (app.versionName !== gradleVersionName || app.versionCode !== gradleVersionCode || app.runtimeVersion !== manifestRuntime) {
    throw new Error(
      `Android release versions are inconsistent: app=${app.versionName}/${app.versionCode}/${app.runtimeVersion}, `
      + `gradle=${gradleVersionName}/${gradleVersionCode}, manifest=${manifestRuntime}`,
    );
  }
  return app;
}

export function updateAndroidReleaseVersion(files: ReleaseSourceFiles, requestedVersion?: string): UpdatedReleaseSourceFiles {
  const previous = readAndroidReleaseVersion(files);
  const versionName = requestedVersion ?? nextPatchVersion(previous.versionName);
  if (!/^\d+\.\d+\.\d+$/u.test(versionName)) throw new Error(`Invalid Android version ${versionName}`);
  if (compareVersions(versionName, previous.versionName) <= 0) {
    throw new Error(`Android version must increase from ${previous.versionName}, received ${versionName}`);
  }
  const versionCode = previous.versionCode + 1;
  const runtimeVersion = `${versionName}-native-${versionCode}`;
  const parsed = JSON.parse(files.appConfig) as {
    expo?: { version?: unknown; runtimeVersion?: unknown; android?: { versionCode?: unknown } };
  };
  if (parsed.expo?.android === undefined) throw new Error("apps/android/app.json must define expo.android");
  parsed.expo.version = versionName;
  parsed.expo.runtimeVersion = runtimeVersion;
  parsed.expo.android.versionCode = versionCode;

  const gradle = replaceExactlyOnce(
    replaceExactlyOnce(
      files.gradle,
      /def codewideVersionCode = \(project\.findProperty\("codewideVersionCode"\) \?: "\d+"\)\.toInteger\(\)/u,
      `def codewideVersionCode = (project.findProperty("codewideVersionCode") ?: "${versionCode}").toInteger()`,
      "Gradle versionCode",
    ),
    /def codewideVersionName = project\.findProperty\("codewideVersionName"\) \?: "[^"]+"/u,
    `def codewideVersionName = project.findProperty("codewideVersionName") ?: "${versionName}"`,
    "Gradle versionName",
  );
  const manifest = replaceExactlyOnce(
    files.manifest,
    /android:name="expo\.modules\.updates\.EXPO_RUNTIME_VERSION" android:value="[^"]+"/u,
    `android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="${runtimeVersion}"`,
    "manifest runtimeVersion",
  );

  return {
    appConfig: `${JSON.stringify(parsed, null, 2)}\n`,
    gradle,
    manifest,
    previous,
    next: { versionName, versionCode, runtimeVersion },
  };
}

function parseAppConfig(source: string): AndroidReleaseVersion {
  const parsed = JSON.parse(source) as {
    expo?: { version?: unknown; runtimeVersion?: unknown; android?: { versionCode?: unknown } };
  };
  const versionName = parsed.expo?.version;
  const runtimeVersion = parsed.expo?.runtimeVersion;
  const versionCode = parsed.expo?.android?.versionCode;
  if (typeof versionName !== "string" || typeof runtimeVersion !== "string" || !Number.isInteger(versionCode)) {
    throw new Error("apps/android/app.json must define version, runtimeVersion, and integer android.versionCode");
  }
  return { versionName, runtimeVersion, versionCode: versionCode as number };
}

function capture(source: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(source);
  if (match?.[1] === undefined) throw new Error(`Could not read ${label}`);
  return match[1];
}

function replaceExactlyOnce(source: string, pattern: RegExp, replacement: string, label: string): string {
  const matches = source.match(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`));
  if (matches?.length !== 1) throw new Error(`Expected exactly one ${label}, found ${matches?.length ?? 0}`);
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
