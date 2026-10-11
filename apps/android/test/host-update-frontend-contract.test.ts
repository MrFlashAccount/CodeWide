import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredConnection } from "../src/data/connection-profile-types";
import { createHostUpdateTransport } from "../src/features/connections/hostUpdateTransport";

const connectionFiles = [
  "ConnectionFeature.tsx",
  "hostUpdatePresentation.ts",
  "HostUpdateSettings.tsx",
  "hostUpdateContract.ts",
  "hostUpdateResource.ts",
  "hostUpdateResourceState.ts",
  "hostUpdateSettingsContract.ts",
  "hostUpdateTransport.ts",
  "hostUpdateWorkspaceBinding.ts",
  "useHostUpdateProjection.ts",
].map((name) =>
  readFileSync(new URL(`../src/features/connections/${name}`, import.meta.url), "utf8"),
);
const transportSource = readFileSync(
  new URL("../src/features/connections/hostUpdateTransport.ts", import.meta.url),
  "utf8",
);
const settings = readFileSync(
  new URL("../src/features/settings/SettingsFeature.tsx", import.meta.url),
  "utf8",
);

describe("Android host update ownership", () => {
  it("keeps transport and resource ownership out of Settings", () => {
    expect(settings).toContain('from "../connections/connectionSettingsContract"');
    expect(settings).not.toContain("hostUpdateTransport");
    expect(settings).not.toContain("hostUpdateResource");
    expect(settings).not.toContain("fetch(");
  });

  it("starts no host-update render load from an effect", () => {
    for (const source of connectionFiles) {
      expect(source).not.toMatch(/\buse(?:Layout)?Effect\b/u);
      expect(source).not.toMatch(/\buse(?:Callback|Memo)\b/u);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses only the authenticated private V1 host-update routes", async () => {
    // The route set is the private Companion/Relay HTTP contract; the Relay
    // updater reuses the same transport through its own V1 base path.
    for (const basePath of [undefined, "/v1/relay-update"] as const) {
      const requests: { readonly method: string; readonly url: string; readonly auth: string | null }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          requests.push({
            auth: new Headers(init?.headers).get("authorization"),
            method: init?.method ?? "GET",
            url,
          });
          return new Response("{}", { status: 200 });
        }),
      );
      const connection: StoredConnection = {
        displayName: "Host",
        enabled: true,
        endpoint: "wss://host.example",
        iconId: "server",
        id: "connection-1",
        lastError: null,
        lastErrorAt: null,
        sortOrder: 0,
        state: "live",
        token: "",
      };
      const transport = createHostUpdateTransport(
        {
          currentConnections: () => [connection],
          nativeCompanionHttpOrigin: async () => "https://pinned.example/cap",
          scopedHttpAuthorization: async () => "Bearer scoped",
        },
        basePath === undefined ? {} : { basePath },
      );
      const ignore = () => undefined;
      await transport.readStatus("connection-1").catch(ignore);
      await transport.check("connection-1").catch(ignore);
      await transport.apply("connection-1", "fingerprint", "key").catch(ignore);
      await transport.readOperation("connection-1", "op/1").catch(ignore);
      await transport.reconnect("connection-1", "op/1").catch(ignore);
      const root = basePath ?? "/v1/host-update";
      expect(requests).toEqual([
        { auth: "Bearer scoped", method: "GET", url: `https://pinned.example/cap${root}` },
        { auth: "Bearer scoped", method: "POST", url: `https://pinned.example/cap${root}/check` },
        { auth: "Bearer scoped", method: "POST", url: `https://pinned.example/cap${root}/apply` },
        { auth: "Bearer scoped", method: "GET", url: `https://pinned.example/cap${root}/operations/op%2F1` },
        {
          auth: "Bearer scoped",
          method: "POST",
          url: `https://pinned.example/cap${root}/operations/op%2F1/reconnect`,
        },
      ]);
    }
    expect(transportSource).toContain("scopedHttpAuthorization");
    expect(transportSource).toContain("nativeCompanionHttpOrigin");
    expect(transportSource).not.toMatch(/artifactUrl|downloadUrl|targetUrl/u);
  });
});
