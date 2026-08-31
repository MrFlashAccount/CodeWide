import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const index = readFileSync(resolve(packageRoot, "src/index.ts"), "utf8");

if (/from\s*["']\.\/v2(?:\/index)?["']/u.test(index)) {
  throw new Error("The package root must not re-export Sync V2");
}

for (const file of files(resolve(repositoryRoot, "apps/android/src"))) {
  if (!/\.[cm]?[jt]sx?$/u.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const rootImports = [...source.matchAll(/import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*["']@codewide\/sync-client["']/gu)];
  const imported = rootImports.flatMap((match) => match[1].split(",").map((name) => name.trim().replace(/^type\s+/u, "")));
  if (imported.some((name) => /^(?:SyncV2|V2[A-Z]|v2SavedServerId)/u.test(name))) {
    throw new Error(`Android imports V2 through the package root: ${relative(repositoryRoot, file)}`);
  }
}

const session = readFileSync(resolve(packageRoot, "src/v2/session.ts"), "utf8");
for (const forbiddenRawSessionSurface of [
  "export type SyncV2Connection =",
  "socketFactory",
  "tlsPinSha256",
  "deviceId",
  "endpoint:",
]) {
  if (session.includes(forbiddenRawSessionSurface)) {
    throw new Error(`SyncV2Session still exposes raw connection authority: ${forbiddenRawSessionSurface}`);
  }
}
for (const requiredBoundSurface of ["savedServerId: string", "transportLease: SyncV2TransportLease", "openSync()"] ) {
  if (!session.includes(requiredBoundSurface)) {
    throw new Error(`SyncV2Session is missing the bound transport contract: ${requiredBoundSurface}`);
  }
}

for (const lifecycle of ["sync-v2-lifecycle.native.ts", "sync-v2-lifecycle.web.ts"]) {
  if (existsSync(resolve(repositoryRoot, "apps/android/src/native", lifecycle))) {
    throw new Error(`Legacy Sync V2 canary remains: ${lifecycle}`);
  }
}
const workspace = readFileSync(resolve(repositoryRoot, "apps/android/src/data/use-remote-workspace.ts"), "utf8");
if (/syncV2Lifecycle|sync-v2-lifecycle|createNativeSyncV2Lifecycle/u.test(workspace)) {
  throw new Error("Legacy workspace still starts the Sync V2 canary");
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
