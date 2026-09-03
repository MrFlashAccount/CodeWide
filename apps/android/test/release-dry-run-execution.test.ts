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
  it("builds and validates Companion without installing or restarting it", () => {
    const fixture = createFixture("companion");
    copyFixtureFile(fixture, "scripts/release-companion");
    copyFixtureFile(fixture, "scripts/build-companion.sh");
    for (const path of [
      "apps/companion/deploy/memory-watch.sh",
      "apps/companion/deploy/codewide-companion.service",
      "apps/companion/deploy/codewide-companion-memory-watch.service",
      "apps/companion/deploy/codewide-companion-memory-watch.timer",
    ]) copyFixtureFile(fixture, path);
    chmodSync(join(fixture, "scripts/release-companion"), 0o755);
    chmodSync(join(fixture, "scripts/build-companion.sh"), 0o755);
    chmodSync(join(fixture, "apps/companion/deploy/memory-watch.sh"), 0o755);

    const commands = createCommandDirectory(fixture);
    const commandLog = join(fixture, "commands.log");
    writeExecutable(join(commands, "git"), `#!/bin/sh
printf 'git %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1 $2" = "rev-parse HEAD" ]; then printf '%s\\n' 0123456789abcdef; fi
exit 0
`);
    writeExecutable(join(commands, "cargo"), `#!/bin/sh
printf 'cargo %s\\n' "$*" >>"$COMMAND_LOG"
case " $* " in
  *" build "*)
    mkdir -p target/release
    printf companion >target/release/codewide-companion
    printf plugin >target/release/codewide-vcs-git
    chmod 755 target/release/codewide-companion target/release/codewide-vcs-git
    ;;
esac
exit 0
`);
    for (const command of ["install", "systemctl"]) {
      writeExecutable(join(commands, command), `#!/bin/sh
printf '${command} %s\\n' "$*" >>"$MUTATION_LOG"
exit 97
`);
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
      "codewide-vcs-git",
    ]);
    expect(readOptionalFile(mutationLog)).toBe("");
    expect(readOptionalFile(join(fixture, "home/.local/lib/codewide/codewide-companion"))).toBe("");
  });

  it("constructs OTA and APK artifacts without publishing either one", () => {
    const fixture = createAndroidFixture();
    const commands = createCommandDirectory(fixture);
    const commandLog = join(fixture, "commands.log");
    const toolchain = createFakeAndroidToolchain(fixture);
    const tsx = join(repositoryRoot, "node_modules/.bin/tsx");
    writeExecutable(join(commands, "pnpm"), `#!/bin/sh
printf 'pnpm %s\\n' "$*" >>"$COMMAND_LOG"
if [ "$1" = "ota:publish:raw" ]; then
  exec "$TEST_TSX" scripts/publish-android-ota.ts --dry-run
fi
if [ "$1 $2" = "exec expo" ]; then
  output=
  previous=
  for argument in "$@"; do
    if [ "$previous" = "--output-dir" ]; then output=$argument; fi
    previous=$argument
  done
  test -n "$output"
  mkdir -p "$output"
  printf '%s' '{"fileMetadata":{"android":{"bundle":"index.hbc","assets":[]}}}' >"$output/metadata.json"
  printf bundle >"$output/index.hbc"
  exit 0
fi
if [ "$1" = "android:gradle" ]; then
  mkdir -p apps/android/android/app/build/outputs/apk/release
  printf apk >apps/android/android/app/build/outputs/apk/release/app-release.apk
  node -e 'const fs=require("fs");const app=JSON.parse(fs.readFileSync("apps/android/app.json","utf8")).expo;fs.writeFileSync("apps/android/android/app/build/outputs/apk/release/output-metadata.json",JSON.stringify({elements:[{outputFile:"app-release.apk",versionName:app.version,versionCode:app.android.versionCode}]}));'
  exit 0
fi
if [ "$1" = "security:scan-artifacts" ]; then
  test -e "$3"
  exit 0
fi
exit 0
`);

    const environment = {
      ANDROID_HOME: toolchain.androidHome,
      CODEWIDE_OTA_PRIVATE_KEY: toolchain.privateKey,
      CODEWIDE_RELEASE_PASSWORD_FILE: toolchain.passwordFile,
      CODEWIDE_RELEASE_STORE_FILE: toolchain.keyStore,
      CODEWIDE_UPDATE_URL: "https://dry-run.invalid/api/updates",
      COMMAND_LOG: commandLog,
      HOME: join(fixture, "home"),
      JAVA_HOME: toolchain.javaHome,
      PATH: `${commands}:${process.env.PATH ?? ""}`,
      TEST_TSX: tsx,
      XDG_DATA_HOME: join(fixture, "data"),
    };
    const originalSources = readAndroidSources(fixture);

    const ota = runCommand(tsx, ["scripts/release-android.ts", "ota", "--dry-run"], fixture, environment);
    expect(ota.stdout).toContain('"artifact": "built-signed-scanned"');
    expect(releaseFiles(fixture, "builds/ota")).toEqual([]);

    const apk = runCommand(tsx, ["scripts/release-android.ts", "apk", "--dry-run"], fixture, environment);
    expect(apk.stdout).toContain('"artifact": "built-signed-scanned"');
    expect(apk.stdout).toContain('"dryRun": true');
    expect(readAndroidSources(fixture)).toEqual(originalSources);
    expect(releaseFiles(fixture, "builds/android")).toEqual([]);

    const log = readFileSync(commandLog, "utf8");
    expect(log).toContain("pnpm ota:publish:raw -- --dry-run");
    expect(log).toContain("pnpm exec expo export --platform android --output-dir");
    expect(log).toContain("pnpm android:gradle -- :app:assembleRelease");
    expect(log.match(/pnpm security:scan-artifacts/gmu)).toHaveLength(2);
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
    "scripts/release-android.ts",
    "scripts/android-release-lib.ts",
    "scripts/publish-android-ota.ts",
    "apps/android/app.json",
    "apps/android/android/app/build.gradle",
    "apps/android/android/app/src/main/AndroidManifest.xml",
  ]) copyFixtureFile(root, path);
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

function runCommand(command: string, args: string[], cwd: string, extraEnvironment: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
  if (result.status !== 0) {
    throw new Error(`Command failed with ${result.status ?? result.signal}:\n${result.stdout}\n${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function createFakeAndroidToolchain(fixture: string): {
  androidHome: string;
  javaHome: string;
  keyStore: string;
  passwordFile: string;
  privateKey: string;
} {
  const javaHome = join(fixture, "java");
  const androidHome = join(fixture, "android-sdk");
  writeExecutable(joinWithDirectory(javaHome, "bin/java"), "#!/bin/sh\nexit 0\n");
  writeExecutable(joinWithDirectory(javaHome, "bin/keytool"), "#!/bin/sh\nexit 0\n");
  writeExecutable(joinWithDirectory(androidHome, "build-tools/1/apksigner"), "#!/bin/sh\nexit 0\n");

  const signingRoot = join(fixture, "signing");
  mkdirSync(signingRoot, { recursive: true });
  const keyStore = join(signingRoot, "release.keystore");
  const passwordFile = join(signingRoot, "release.password");
  writeFileSync(keyStore, "fake", { mode: 0o600 });
  writeFileSync(passwordFile, "test-password\n", { mode: 0o600 });

  const privateKey = join(signingRoot, "private-key.pem");
  const certificate = join(fixture, "apps/android/certs/certificate.pem");
  mkdirSync(dirname(certificate), { recursive: true });
  const generated = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", privateKey,
    "-out", certificate,
    "-days", "1",
    "-subj", "/CN=CodeWide dry run test",
  ], { encoding: "utf8" });
  if (generated.status !== 0) throw new Error(`Could not generate test certificate: ${generated.stderr}`);
  chmodSync(privateKey, 0o600);
  return { androidHome, javaHome, keyStore, passwordFile, privateKey };
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

function releaseFiles(fixture: string, relativePath: string): string[] {
  const root = join(fixture, relativePath);
  try {
    return readdirSync(root, { recursive: true }).map(String).sort();
  } catch {
    return [];
  }
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
