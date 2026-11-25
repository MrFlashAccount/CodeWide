import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredConnection } from "../src/data/connection-profile-types";
import {
  createHostUpdateTransport,
  HostUpdateUnreachableError,
} from "../src/features/connections/hostUpdateTransport";
import { urlTransport } from "../src/native/urlTransport";

describe("Android host update ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("bounds a hung session authorization and never sends a late apply after timeout", async () => {
    vi.useFakeTimers();
    const authorization = Promise.withResolvers<string>();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const connection: StoredConnection = {
      displayName: "Host",
      enabled: true,
      endpoint: "wss://host.example",
      iconId: "server",
      id: "server",
      lastError: null,
      lastErrorAt: null,
      sortOrder: 0,
      state: "connecting",
      token: "",
    };
    const transport = createHostUpdateTransport(
      {
        currentConnections: () => [connection],
        connectionTransport: () => ({
          baseUrl: "https://pinned.example/cap",
          transport: urlTransport,
        }),
        scopedHttpAuthorization: async () => authorization.promise,
      },
      { requestTimeoutMilliseconds: 10 },
    );
    const outcome = transport.apply("server", "fingerprint", "key").catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: expect.stringContaining("in time") }),
    );
    authorization.resolve("Bearer scoped");
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds a stalled HTTP body so operation polling can resume", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => undefined) })),
    );
    const connection: StoredConnection = {
      displayName: "Host",
      enabled: true,
      endpoint: "wss://host.example",
      iconId: "server",
      id: "server",
      lastError: null,
      lastErrorAt: null,
      sortOrder: 0,
      state: "live",
      token: "",
    };
    const transport = createHostUpdateTransport(
      {
        currentConnections: () => [connection],
        connectionTransport: () => ({
          baseUrl: "https://pinned.example/cap",
          transport: urlTransport,
        }),
        scopedHttpAuthorization: async () => "Bearer scoped",
      },
      { requestTimeoutMilliseconds: 10 },
    );
    const outcome = transport
      .readOperation("server", "operation-00000000000000000000")
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    const error: unknown = await outcome;
    // A timeout says nothing about the update: an active operation keeps waiting.
    expect(error).toBeInstanceOf(HostUpdateUnreachableError);
    expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining("in time") }));
  });

  it("uses only the authenticated private V1 host-update routes", async () => {
    // The route set is the private Companion/Relay HTTP contract; the Relay
    // updater reuses the same transport through its own V1 base path.
    for (const basePath of [undefined, "/v1/relay-update"] as const) {
      const requests: {
        readonly method: string;
        readonly url: string;
        readonly auth: string | null;
      }[] = [];
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
          connectionTransport: () => ({
            baseUrl: "https://pinned.example/cap",
            transport: urlTransport,
          }),
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
        {
          auth: "Bearer scoped",
          method: "GET",
          url: `https://pinned.example/cap${root}/operations/op%2F1`,
        },
        {
          auth: "Bearer scoped",
          method: "POST",
          url: `https://pinned.example/cap${root}/operations/op%2F1/reconnect`,
        },
      ]);
    }
  });
});
