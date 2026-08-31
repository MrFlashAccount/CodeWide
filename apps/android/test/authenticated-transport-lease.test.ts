import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("opaque authenticated transport lease", () => {
  it("exposes only SavedServerId, closed purposes, bounded I/O, and release", () => {
    const contract = read("../src/native/authenticated-transport-lease.contract.ts");
    expect(contract).toContain('"sync-v2" | "terminal-v2" | "voice-v2"');
    expect(contract).toContain('"files-v2" | "media-v2" | "ports-v2" | "tunnels-v2"');
    expect(contract).toContain("readonly savedServerId: string");
    expect(contract).toContain('operation: "file.download"');
    expect(contract).toContain('operation: "media.materialize"');
    expect(contract).toContain('operation: "ports.list"');
    expect(contract).toContain('operation: "tunnel.create"');
    expect(contract).toContain('operation: "tunnel.delete"');
    expect(contract).toContain("release(): Promise<void>");
    for (const forbidden of [
      "endpoint",
      "origin",
      "deviceId",
      "credential",
      "token",
      "tlsPin",
      "leaseHandle",
      "WebSocket",
    ]) {
      expect(contract).not.toContain(forbidden);
    }
  });

  it("keeps purpose resolution and authentication inside the native connection service", () => {
    const registry = read(
      "../android/app/src/main/java/dev/codewide/app/remote/AuthenticatedTransportLease.kt",
    );
    expect(registry).toContain('"sync-v2" -> "/v2/sync"');
    expect(registry).toContain('"terminal-v2" -> "/v2/terminals"');
    expect(registry).toContain('"voice-v2" -> "/v2/voice"');
    expect(registry).toContain('"file.download"');
    expect(registry).toContain('"media.materialize"');
    expect(registry).toContain('"ports.list"');
    expect(registry).toContain('"tunnel.create"');
    expect(registry).toContain('"tunnel.delete"');
    expect(registry).toContain("SessionCredentialClient.mint");
    expect(registry).toContain("InnerTlsTransport.client");
    expect(registry).toContain("UUID.randomUUID()");
    expect(registry).toContain("val lease = leases.remove(handle) ?: return");
  });

  it("prevents V2 consumers from importing raw transport construction", () => {
    const adapter = read("../src/v2/infrastructure/connection/sharedConnectionAdapter.native.ts");
    expect(adapter).toContain("acquireAuthenticatedTransportLease");
    expect(adapter).toContain('lease.openDuplex("sync-v2")');
    for (const forbidden of [
      "native-transport",
      "mintNativeSession",
      "nativeCompanionHttpOrigin",
      "listNativeConnectionConfigs",
      "WebSocket",
    ]) {
      expect(adapter).not.toContain(forbidden);
    }
  });
});
