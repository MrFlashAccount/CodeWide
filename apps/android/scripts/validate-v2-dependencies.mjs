import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const inputs = ["app", "src/boot", "src/presentation"];

if (existsSync("src/v2")) {
  inputs.push("src/v2");
}

const result = spawnSync(
  "depcruise",
  ["--config", "dependency-cruiser.v2.config.mjs", "--output-type", "err", ...inputs],
  { stdio: "inherit" },
);

if (result.error) {
  throw result.error;
}

const terminalManager = readFileSync(
  "src/v2/infrastructure/terminal/closedTerminalTransport.native.ts",
  "utf8",
);
for (const forbiddenLegacyCall of [
  "NativeSessionCredentialsStore",
  "SessionCredentialClient.mint",
  "InnerTlsTransport.url",
  "InnerTlsTransport.client",
  "/v1/auth",
  "/v1/e2ee-tunnel",
]) {
  if (terminalManager.includes(forbiddenLegacyCall)) {
    throw new Error(`V2 Terminal bypasses the opaque authenticated lease: ${forbiddenLegacyCall}`);
  }
}
for (const requiredLeaseCall of [
  "acquireSharedConnectionLease",
  "openDuplex",
  '"terminal-v2"',
  ".release()",
]) {
  if (!terminalManager.includes(requiredLeaseCall)) {
    throw new Error(
      `V2 Terminal does not use the service-owned opaque lease: ${requiredLeaseCall}`,
    );
  }
}

const connectionAdapter = readFileSync(
  "src/v2/infrastructure/connection/sharedConnectionAdapter.native.ts",
  "utf8",
);
for (const forbiddenRawAccess of [
  "native-transport",
  "mintNativeSession",
  "nativeCompanionHttpOrigin",
  "listNativeConnectionConfigs",
  "WebSocket",
]) {
  if (connectionAdapter.includes(forbiddenRawAccess)) {
    throw new Error(
      `V2 connection adapter exposes raw connection authority: ${forbiddenRawAccess}`,
    );
  }
}

const routeFiles = spawnSync("rg", ["--files", "app"], { encoding: "utf8" });
if (routeFiles.status !== 0) throw new Error("Could not enumerate Android routes");
for (const routeFile of routeFiles.stdout.trim().split("\n")) {
  if (routeFile.includes("[connectionId]"))
    throw new Error(`Stale V2 route identity: ${routeFile}`);
}

const v2Database = readFileSync("src/v2/infrastructure/persistence/v2Database.native.ts", "utf8");
if (!v2Database.includes('name: "codewide-v2.db"')) {
  throw new Error("V2 durable stores do not use the required physical database boundary");
}

process.exitCode = result.status ?? 1;
