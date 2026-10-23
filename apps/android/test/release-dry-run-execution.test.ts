import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const temporaryRoots: string[] = [];

type CommandResult = {
  stdout: string;
  stderr: string;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("release dry runs", () => {
  it("limits release and Preview APKs to physical-device ABIs", () => {
    const fixture = createFixture("android-gradle");
    copyFixtureFile(fixture, "scripts/android-gradle.sh");
    chmodSync(join(fixture, "scripts/android-gradle.sh"), 0o755);
    const commands = createCommandDirectory(fixture);
    const commandLog = join(fixture, "commands.log");
    writeExecutable(join(commands, "pnpm"), "#!/bin/sh\nexit 0\n");
    writeExecutable(
      joinWithDirectory(fixture, "apps/android/android/gradlew"),
      `#!/bin/sh
printf '%s\\n' "$*" >>"$COMMAND_LOG"
`,
    );
    const javaHome = join(fixture, "java");
    const androidHome = join(fixture, "android-sdk");
    writeExecutable(joinWithDirectory(javaHome, "bin/java"), "#!/bin/sh\nexit 0\n");
    mkdirSync(androidHome, { recursive: true });
    const environment = {
      ANDROID_HOME: androidHome,
      COMMAND_LOG: commandLog,
      HOME: join(fixture, "home"),
      JAVA_HOME: javaHome,
      PATH: `${commands}:${process.env.PATH ?? ""}`,
    };

    runCommand(
      "sh",
      ["scripts/android-gradle.sh", "--", ":app:assembleRelease"],
      fixture,
      environment,
    );
    runCommand(
      "sh",
      ["scripts/android-gradle.sh", "--", ":app:assemblePreview"],
      fixture,
      environment,
    );
    runCommand(
      "sh",
      ["scripts/android-gradle.sh", "--", ":app:assembleDebug"],
      fixture,
      environment,
    );

    const log = readFileSync(commandLog, "utf8").split("\n");
    expect(log).toHaveLength(4);
    expect(log[0]).toMatch(/ -PreactNativeArchitectures=arm64-v8a :app:assembleRelease$/u);
    expect(log[1]).toMatch(/ -PreactNativeArchitectures=arm64-v8a :app:assemblePreview$/u);
    expect(log[2]).toMatch(/\/apps\/android\/android :app:assembleDebug$/u);
  });

  it("keeps release-candidate deployment behind exactly three operator one-shots", () => {
    const fixture = createFixture("candidate-one-shots");
    for (const path of [
      "scripts/release-candidate-android",
      "scripts/release-candidate-android-ota",
      "scripts/release-candidate-companion",
      "scripts/release-candidate-server.py",
      "scripts/release-candidate-server.test.py",
      "scripts/release-candidate-site.html",
      "scripts/update-release-candidate-manifest.mjs",
    ])
      copyFixtureFile(fixture, path);
    chmodSync(join(fixture, "scripts/release-candidate-android"), 0o755);
    chmodSync(join(fixture, "scripts/release-candidate-android-ota"), 0o755);
    chmodSync(join(fixture, "scripts/release-candidate-companion"), 0o755);

    const commandLog = join(fixture, "commands.log");
    writeExecutable(
      joinWithDirectory(fixture, "scripts/release-companion"),
      `#!/bin/sh
printf 'companion %s\\n' "$*" >>"$COMMAND_LOG"
printf '%s\\n' '{"release":"companion","status":"published"}'
`,
    );
    writeExecutable(
      joinWithDirectory(fixture, "scripts/build-android-apk"),
      `#!/bin/sh
printf 'android %s\\n' "$*" >>"$COMMAND_LOG"
printf 'android-url %s\\n' "$CODEWIDE_UPDATE_URL" >>"$COMMAND_LOG"
mkdir -p apps/android/android/app/build/outputs/apk/preview
printf candidate >apps/android/android/app/build/outputs/apk/preview/app-preview.apk
printf '%s\\n' '{"applicationId":"dev.codexremote.app.preview","variantName":"preview","elements":[{"outputFile":"app-preview.apk","versionName":"0.0.0.0","versionCode":42}]}' >apps/android/android/app/build/outputs/apk/preview/output-metadata.json
`,
    );
    const commands = createCommandDirectory(fixture);
    writeExecutable(
      join(commands, "pnpm"),
      `#!/bin/sh
printf 'pnpm %s\\n' "$*" >>"$COMMAND_LOG"
case "$*" in
  *publish-release-candidate-ota.ts*)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --output-root) OUTPUT_ROOT=$2; shift 2 ;;
        --runtime-version) RUNTIME_VERSION=$2; shift 2 ;;
        --update-url) UPDATE_URL=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    PUBLISH_COUNT_FILE="$OUTPUT_ROOT/publish-count"
    PUBLISH_COUNT=0
    if [ -r "$PUBLISH_COUNT_FILE" ]; then PUBLISH_COUNT=$(cat "$PUBLISH_COUNT_FILE"); fi
    PUBLISH_COUNT=$((PUBLISH_COUNT + 1))
    mkdir -p "$OUTPUT_ROOT/$RUNTIME_VERSION"
    printf '%s\\n' "$PUBLISH_COUNT" >"$PUBLISH_COUNT_FILE"
    printf '{"createdAt":"2026-10-22T00:00:0%s.000Z","runtimeVersion":"%s","updateId":"candidate-update-%s","updateUrl":"%s","directory":"candidate-%s"}\\n' "$PUBLISH_COUNT" "$RUNTIME_VERSION" "$PUBLISH_COUNT" "$UPDATE_URL" "$PUBLISH_COUNT" >"$OUTPUT_ROOT/$RUNTIME_VERSION/current.json"
    ;;
  *verify-release-candidate.ts*)
    printf '%s\\n' '{"release": "android-release-candidate", "status": "published"}'
    ;;
esac
`,
    );
    writeExecutable(
      join(commands, "git"),
      `#!/bin/sh
if [ "$1 $2" = "branch --show-current" ]; then printf '%s\\n' integration/release-candidate; else printf '%s\\n' 0123456789abcdef; fi
`,
    );
    const siteRoot = join(fixture, "site");
    const environment = {
      CODEWIDE_RELEASE_CANDIDATE_SITE_ROOT: siteRoot,
      COMMAND_LOG: commandLog,
      PATH: `${commands}:${process.env.PATH ?? ""}`,
      TMPDIR: join(fixture, "tmp"),
    };

    expect(
      runCommand("sh", ["scripts/release-candidate-companion"], fixture, environment).stdout,
    ).toContain('"status":"published"');
    expect(
      runCommand(
        "sh",
        ["scripts/release-candidate-android", "--version-code", "42"],
        fixture,
        environment,
      ).stdout,
    ).toContain('"release": "android-release-candidate"');
    expect(
      runCommand("sh", ["scripts/release-candidate-android-ota"], fixture, environment).stdout,
    ).toContain('"release": "android-release-candidate"');

    expect(readFileSync(commandLog, "utf8").split("\n")).toEqual([
      "companion ",
      "android --preview --version-code 42",
      "android-url https://codewide-rc-download-p4186.zrok-safe-share.garin.dev/api/updates",
      expect.stringContaining(
        "pnpm exec tsx scripts/publish-release-candidate-ota.ts --output-root",
      ),
      expect.stringContaining("pnpm exec tsx scripts/verify-release-candidate.ts --manifest"),
      "pnpm validate:android:v1",
      "pnpm --filter @codewide/android compile:android",
      "pnpm --filter @codewide/android typecheck",
      "pnpm --filter @codewide/android lint",
      "pnpm test",
      "pnpm security:scan-secrets",
      expect.stringContaining(
        "pnpm exec tsx scripts/publish-release-candidate-ota.ts --output-root",
      ),
      expect.stringContaining("pnpm exec tsx scripts/verify-release-candidate.ts --manifest"),
      "",
    ]);
    expect(readFileSync(join(siteRoot, "CodeWide-Preview.apk"), "utf8")).toBe("candidate");
    expect(JSON.parse(readFileSync(join(siteRoot, "manifest.json"), "utf8"))).toMatchObject({
      branch: "integration/release-candidate",
      revision: "0123456789abcdef",
      sourceDirty: true,
      ota: {
        runtimeVersion: "0.0.0.0-native-42",
        updateId: "candidate-update-2",
      },
      artifacts: [
        {
          kind: "android-preview-apk",
          applicationId: "dev.codexremote.app.preview",
          versionName: "0.0.0.0",
          versionCode: 42,
        },
      ],
    });
  });

  it("refuses to attach an OTA to a different Preview runtime", () => {
    const fixture = createFixture("candidate-ota-runtime");
    copyFixtureFile(fixture, "scripts/update-release-candidate-manifest.mjs");
    const manifestPath = join(fixture, "manifest.json");
    const pointerPath = join(fixture, "current.json");
    const manifest = {
      artifacts: [
        {
          applicationId: "dev.codexremote.app.preview",
          kind: "android-preview-apk",
          versionCode: 42,
          versionName: "0.0.0.0",
        },
      ],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(
      pointerPath,
      JSON.stringify({
        createdAt: "2026-10-22T00:00:00.000Z",
        runtimeVersion: "0.0.0.0-native-43",
        updateId: "wrong-runtime",
        updateUrl: "https://candidate.invalid/api/updates",
      }),
    );

    const result = spawnSync(
      process.execPath,
      [
        "scripts/update-release-candidate-manifest.mjs",
        "--manifest",
        manifestPath,
        "--ota-pointer",
        pointerPath,
        "--branch",
        "integration/release-candidate",
        "--revision",
        "0123456789abcdef",
        "--source-dirty",
        "true",
      ],
      { cwd: fixture, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "OTA runtime 0.0.0.0-native-43 does not match published Preview 0.0.0.0-native-42",
    );
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
  });

  it("builds and validates Companion without installing or restarting it", () => {
    const fixture = createFixture("companion");
    copyFixtureFile(fixture, "scripts/release-companion");
    copyFixtureFile(fixture, "scripts/build-companion.sh");
    copyFixtureFile(fixture, "scripts/cargo-target-budget.sh");
    for (const path of [
      "apps/companion-linux/deploy/memory-watch.sh",
      "apps/companion-linux/deploy/codewide-companion.service",
      "apps/companion-linux/deploy/codewide-companion-memory-watch.service",
      "apps/companion-linux/deploy/codewide-companion-memory-watch.timer",
    ])
      copyFixtureFile(fixture, path);
    chmodSync(join(fixture, "scripts/release-companion"), 0o755);
    chmodSync(join(fixture, "scripts/build-companion.sh"), 0o755);
    chmodSync(join(fixture, "scripts/cargo-target-budget.sh"), 0o755);
    chmodSync(join(fixture, "apps/companion-linux/deploy/memory-watch.sh"), 0o755);

    const commands = createCommandDirectory(fixture);
    const commandLog = join(fixture, "commands.log");
    writeExecutable(
      join(commands, "git"),
      `#!/bin/sh
printf 'git %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1 $2" = "rev-parse HEAD" ]; then printf '%s\\n' 0123456789abcdef; fi
exit 0
`,
    );
    writeExecutable(
      join(commands, "cargo"),
      `#!/bin/sh
printf 'cargo %s\\n' "$*" >>"$COMMAND_LOG"
case " $* " in
  *" build "*)
    mkdir -p target/release
    printf companion >target/release/codewide-companion
    printf plugin >target/release/codewide-vcs-git
    printf forge >target/release/codewide-forge-github
    chmod 755 target/release/codewide-companion target/release/codewide-vcs-git target/release/codewide-forge-github
    ;;
esac
exit 0
`,
    );
    for (const command of ["install", "systemctl"]) {
      writeExecutable(
        join(commands, command),
        `#!/bin/sh
printf '${command} %s\\n' "$*" >>"$MUTATION_LOG"
exit 97
`,
      );
    }

    const mutationLog = join(fixture, "mutations.log");
    const result = runCommand("sh", ["scripts/release-companion", "--dry-run"], fixture, {
      COMMAND_LOG: commandLog,
      HOME: join(fixture, "home"),
      MUTATION_LOG: mutationLog,
      PATH: `${commands}:${process.env.PATH ?? ""}`,
      TMPDIR: join(fixture, "tmp"),
    });

    expect(result.stdout).toContain('"status":"validated"');
    expect(result.stdout).toContain('"dryRun":true');
    expect(readFileSync(commandLog, "utf8")).toContain("cargo build --release");
    expect(readFileSync(commandLog, "utf8")).toContain("cargo test --workspace --all-features");
    expect(readdirSync(join(fixture, "target/release"))).toEqual([
      "codewide-companion",
      "codewide-forge-github",
      "codewide-vcs-git",
    ]);
    expect(readOptionalFile(mutationLog)).toBe("");
    expect(readOptionalFile(join(fixture, "home/.local/lib/codewide/codewide-companion"))).toBe("");
  });

  it("builds, signs and scans the APK at the requested version without changing the checkout", () => {
    const fixture = createAndroidFixture();
    const commands = createCommandDirectory(fixture);
    const commandLog = join(fixture, "commands.log");
    const toolchain = createFakeAndroidToolchain(fixture);
    const tsx = join(repositoryRoot, "node_modules/.bin/tsx");
    writeExecutable(
      join(commands, "pnpm"),
      `#!/bin/sh
printf 'pnpm %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1" = "android:gradle" ]; then
  printf 'CODEWIDE_UPDATE_URL=%s\\n' "$CODEWIDE_UPDATE_URL" >>"$COMMAND_LOG"
  case " $* " in
    *" :app:assemblePreview "*)
      OUTPUT_DIRECTORY=apps/android/android/app/build/outputs/apk/preview
      OUTPUT_FILE=app-preview.apk
      APPLICATION_ID=dev.codexremote.app.preview
      ;;
    *)
      OUTPUT_DIRECTORY=apps/android/android/app/build/outputs/apk/release
      OUTPUT_FILE=app-release.apk
      APPLICATION_ID=dev.codexremote.app
      ;;
  esac
  export OUTPUT_DIRECTORY OUTPUT_FILE APPLICATION_ID
  mkdir -p "$OUTPUT_DIRECTORY"
  printf apk >"$OUTPUT_DIRECTORY/$OUTPUT_FILE"
  node -e 'const fs=require("fs");const app=JSON.parse(fs.readFileSync("apps/android/app.json","utf8")).expo;fs.writeFileSync(process.env.OUTPUT_DIRECTORY+"/output-metadata.json",JSON.stringify({applicationId:process.env.APPLICATION_ID,elements:[{outputFile:process.env.OUTPUT_FILE,versionName:app.version,versionCode:app.android.versionCode}]}));'
  exit 0
fi
if [ "$1" = "security:scan-artifacts" ]; then
  test -e "$3"
  exit 0
fi
exit 0
`,
    );

    const environment = {
      ANDROID_HOME: toolchain.androidHome,
      CODEWIDE_PREVIEW_STORE_FILE: toolchain.previewKeyStore,
      CODEWIDE_RELEASE_PASSWORD_FILE: toolchain.passwordFile,
      CODEWIDE_RELEASE_STORE_FILE: toolchain.keyStore,
      CODEWIDE_UPDATE_URL: "",
      COMMAND_LOG: commandLog,
      HOME: join(fixture, "home"),
      JAVA_HOME: toolchain.javaHome,
      PATH: `${commands}:${process.env.PATH ?? ""}`,
      XDG_DATA_HOME: join(fixture, "data"),
    };
    const originalSources = readAndroidSources(fixture);

    const apk = runCommand(
      tsx,
      ["scripts/build-android-apk.ts", "--version", "9.8.7", "--version-code", "9008007"],
      fixture,
      environment,
    );
    const result = parseBuildResult(apk.stdout);
    expect(result).toMatchObject({
      ok: true,
      kind: "apk",
      channel: "release",
      applicationId: "dev.codexremote.app",
      next: { versionName: "9.8.7", versionCode: 9008007, runtimeVersion: "9.8.7-native-9008007" },
      updatesEnabled: false,
      updateUrl: null,
      sha256: createHash("sha256").update("apk").digest("hex"),
      artifact: "built-signed-scanned",
    });
    expect(readAndroidSources(fixture)).toEqual(originalSources);

    const withUpdates = runCommand(
      tsx,
      ["scripts/build-android-apk.ts", "--version", "9.8.8", "--version-code", "9008008"],
      fixture,
      { ...environment, CODEWIDE_UPDATE_URL: "https://updates.invalid/api/updates" },
    );
    expect(parseBuildResult(withUpdates.stdout)).toMatchObject({
      updatesEnabled: true,
      updateUrl: "https://updates.invalid/api/updates",
    });
    expect(readAndroidSources(fixture)).toEqual(originalSources);

    const preview = runCommand(
      tsx,
      ["scripts/build-android-apk.ts", "--preview", "--version-code", "42"],
      fixture,
      environment,
    );
    expect(parseBuildResult(preview.stdout)).toMatchObject({
      ok: true,
      kind: "apk",
      channel: "preview",
      applicationId: "dev.codexremote.app.preview",
      next: { versionName: "0.0.0.0", versionCode: 42, runtimeVersion: "0.0.0.0-native-42" },
      updatesEnabled: false,
      updateUrl: null,
      apkPath: "apps/android/android/app/build/outputs/apk/preview/app-preview.apk",
      sha256: createHash("sha256").update("apk").digest("hex"),
      artifact: "built-signed-scanned",
    });
    expect(readAndroidSources(fixture)).toEqual(originalSources);

    const previewWithUpdates = runCommand(
      tsx,
      ["scripts/build-android-apk.ts", "--preview", "--version-code", "43"],
      fixture,
      { ...environment, CODEWIDE_UPDATE_URL: "https://candidate.invalid/api/updates" },
    );
    expect(parseBuildResult(previewWithUpdates.stdout)).toMatchObject({
      channel: "preview",
      next: { runtimeVersion: "0.0.0.0-native-43", versionCode: 43 },
      updateUrl: "https://candidate.invalid/api/updates",
      updatesEnabled: true,
    });
    expect(readAndroidSources(fixture)).toEqual(originalSources);

    const log = readFileSync(commandLog, "utf8").split("\n");
    const gate = log.indexOf("pnpm validate:android:v1");
    const build = log.indexOf("pnpm android:gradle -- :app:assembleRelease");
    const previewBuild = log.indexOf("pnpm android:gradle -- :app:assemblePreview");
    expect(gate).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(gate);
    expect(previewBuild).toBeGreaterThan(build);
    expect(log).toContain("CODEWIDE_UPDATE_URL=");
    expect(log).toContain("CODEWIDE_UPDATE_URL=https://updates.invalid/api/updates");
    expect(log.filter((line) => line.startsWith("pnpm security:scan-artifacts"))).toHaveLength(4);
  });

  it("restores the checkout version when the APK build fails", () => {
    const fixture = createAndroidFixture();
    const commands = createCommandDirectory(fixture);
    const toolchain = createFakeAndroidToolchain(fixture);
    writeExecutable(
      join(commands, "pnpm"),
      `#!/bin/sh
if [ "$1" = "android:gradle" ]; then exit 1; fi
exit 0
`,
    );
    const originalSources = readAndroidSources(fixture);

    const result = spawnSync(
      join(repositoryRoot, "node_modules/.bin/tsx"),
      ["scripts/build-android-apk.ts", "--version", "9.8.7", "--version-code", "9008007"],
      {
        cwd: fixture,
        encoding: "utf8",
        env: {
          ...process.env,
          ANDROID_HOME: toolchain.androidHome,
          CODEWIDE_RELEASE_PASSWORD_FILE: toolchain.passwordFile,
          CODEWIDE_RELEASE_STORE_FILE: toolchain.keyStore,
          CODEWIDE_UPDATE_URL: "",
          HOME: join(fixture, "home"),
          JAVA_HOME: toolchain.javaHome,
          PATH: `${commands}:${process.env.PATH ?? ""}`,
          XDG_DATA_HOME: join(fixture, "data"),
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("pnpm failed");
    expect(readAndroidSources(fixture)).toEqual(originalSources);
  });
});

function createFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `codewide-release-${name}-`));
  temporaryRoots.push(root);
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  return root;
}

function createAndroidFixture(): string {
  const root = createFixture("android");
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  for (const path of [
    "scripts/build-android-apk.ts",
    "scripts/android-release-lib.ts",
    "apps/android/app.json",
    "apps/android/android/app/build.gradle",
    "apps/android/android/app/src/main/AndroidManifest.xml",
  ])
    copyFixtureFile(root, path);
  return root;
}

function copyFixtureFile(fixture: string, relativePath: string): void {
  const destination = join(fixture, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(repositoryRoot, relativePath), destination);
}

function createCommandDirectory(fixture: string): string {
  const directory = join(fixture, "commands");
  mkdirSync(directory, { recursive: true });
  return directory;
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o755 });
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnvironment: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.status !== 0) {
    throw new Error(
      `Command failed with ${result.status ?? result.signal}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function createFakeAndroidToolchain(fixture: string): {
  androidHome: string;
  javaHome: string;
  keyStore: string;
  passwordFile: string;
  previewKeyStore: string;
} {
  const javaHome = join(fixture, "java");
  const androidHome = join(fixture, "android-sdk");
  writeExecutable(joinWithDirectory(javaHome, "bin/java"), "#!/bin/sh\nexit 0\n");
  writeExecutable(joinWithDirectory(javaHome, "bin/keytool"), "#!/bin/sh\nexit 0\n");
  writeExecutable(joinWithDirectory(androidHome, "build-tools/1/apksigner"), "#!/bin/sh\nexit 0\n");

  const signingRoot = join(fixture, "signing");
  mkdirSync(signingRoot, { recursive: true });
  const keyStore = join(signingRoot, "release.keystore");
  const previewKeyStore = join(signingRoot, "preview.keystore");
  const passwordFile = join(signingRoot, "release.password");
  writeFileSync(keyStore, "fake", { mode: 0o600 });
  writeFileSync(previewKeyStore, "fake", { mode: 0o600 });
  writeFileSync(passwordFile, "test-password\n", { mode: 0o600 });

  return { androidHome, javaHome, keyStore, passwordFile, previewKeyStore };
}

function joinWithDirectory(root: string, relativePath: string): string {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function readAndroidSources(fixture: string): string[] {
  return [
    "apps/android/app.json",
    "apps/android/android/app/build.gradle",
    "apps/android/android/app/src/main/AndroidManifest.xml",
  ].map((path) => readFileSync(join(fixture, path), "utf8"));
}

function parseBuildResult(stdout: string): unknown {
  return JSON.parse(stdout.slice(stdout.indexOf("{")));
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
