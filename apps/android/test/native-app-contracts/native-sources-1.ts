import { readFileSync } from "node:fs";

export const androidSettings = readFileSync(
  new URL("../../android/settings.gradle", import.meta.url),
  "utf8",
);
export const rootGradle = readFileSync(
  new URL("../../android/build.gradle", import.meta.url),
  "utf8",
);
export const baselineGradle = readFileSync(
  new URL("../../android/baselineprofile/build.gradle", import.meta.url),
  "utf8",
);
export const baselineManifest = readFileSync(
  new URL("../../android/baselineprofile/src/main/AndroidManifest.xml", import.meta.url),
  "utf8",
);
export const baselineGenerator = readFileSync(
  new URL(
    "../../android/baselineprofile/src/main/java/dev/codewide/baselineprofile/BaselineProfileGenerator.kt",
    import.meta.url,
  ),
  "utf8",
);
export const startupBenchmark = readFileSync(
  new URL(
    "../../android/baselineprofile/src/main/java/dev/codewide/baselineprofile/StartupBenchmark.kt",
    import.meta.url,
  ),
  "utf8",
);
export const baselineProfile = readFileSync(
  new URL(
    "../../android/app/src/release/generated/baselineProfiles/baseline-prof.txt",
    import.meta.url,
  ),
  "utf8",
);
export const androidGradleScript = readFileSync(
  new URL("../../../../scripts/android-gradle.sh", import.meta.url),
  "utf8",
);
export const expoAssetPatch = readFileSync(
  new URL("../../../../patches/expo-asset@57.0.9.patch", import.meta.url),
  "utf8",
);
