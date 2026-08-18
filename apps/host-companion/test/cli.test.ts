import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { parsePairingPayload } from "@codewide/codex-protocol/pairing";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const controlServers: Server[] = [];

afterEach(async () => {
  await Promise.all(controlServers.splice(0).map(async (server) => {
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }));
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })));
});

describe("host CLI", () => {
  it("emits exactly one machine-readable pairing record with --json", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-cli-"));
    temporaryDirectories.push(directory);
    const adminToken = randomBytes(32).toString("base64url");
    const tokenFile = path.join(directory, "host.token");
    await writeFile(tokenFile, `${adminToken}\n`, { mode: 0o600 });
    const controlEndpoint = path.join(directory, "control.sock");
    const pairingToken = randomBytes(32).toString("base64url");
    const controlServer = createServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/v1/pairing/start");
      expect(request.headers.authorization).toBe(`Bearer ${adminToken}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ pairingToken, expiresAt: Date.now() + 300_000 }));
    });
    await new Promise<void>((resolve, reject) => {
      controlServer.once("error", reject);
      controlServer.listen(controlEndpoint, resolve);
    });
    controlServers.push(controlServer);
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const cli = path.join(workspaceRoot, "apps/host-companion/src/cli.ts");
    const tsx = path.join(workspaceRoot, "node_modules/.bin/tsx");
    const endpoint = "ws://10.0.2.2:8765/v1/sync";
    const result = await execFileAsync(tsx, [cli, "pair", "--json"], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEWIDE_TOKEN_FILE: tokenFile,
        CODEWIDE_CONTROL_ENDPOINT: controlEndpoint,
        CODEWIDE_PUBLIC_ENDPOINT: endpoint,
        CODEWIDE_SERVER_NAME: "AVD test server",
      },
      timeout: 10_000,
    });

    expect(result.stderr).toBe("");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const output = JSON.parse(lines[0]!) as { pairingToken: string; pairingPayload: string; endpoint: string };
    expect(output.endpoint).toBe(endpoint);
    expect(output.pairingToken).toHaveLength(43);
    expect(parsePairingPayload(output.pairingPayload)).toMatchObject({
      endpoint,
      pairingToken: output.pairingToken,
      displayName: "AVD test server",
    });
  });
});
