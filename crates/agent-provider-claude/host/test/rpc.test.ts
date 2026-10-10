/**
 * The stdio JSON-RPC server: handshake, error codes, id echo and event
 * buffering until `initialized`.
 */

import { ModelCatalog } from "../src/catalog/models.js";
import { describe, expect, it, vi } from "vitest";
import { RpcServer } from "../src/rpc/server.js";
import { createMemoryLogger } from "../src/log.js";
import { harness, scriptedRuntime } from "./support/scripted.js";

function server() {
  const lines: unknown[] = [];
  const { service, rateLimits } = harness();
  const { runtime } = scriptedRuntime();

  const rpc = new RpcServer({
    models: new ModelCatalog(),
    rateLimits,
    service,
    runtime,
    logger: createMemoryLogger(),
    write: (line) => lines.push(JSON.parse(line)),
    version: "0.1.0",
  });
  return { rpc, lines, service };
}

const initialize = {
  id: "codewide-companion-initialize",
  method: "initialize",
  params: { protocol: "codewide-agent", protocolVersion: 1, client: { name: "t", version: "0" } },
};

describe("rpc server", () => {
  it("forwards a later sign-in as account.updated once per change", async () => {
    vi.useFakeTimers();
    try {
      const lines: unknown[] = [];
      const { service, rateLimits } = harness();
      const { runtime } = scriptedRuntime();
      const accounts = [
        { authenticated: false, label: null },
        { authenticated: true, label: "max" },
        { authenticated: true, label: "max" },
      ];
      let probes = 0;
      const rpc = new RpcServer({
        models: new ModelCatalog(),
        rateLimits,
        service,
        runtime: {
          ...runtime,
          probe: () => {
            const account = accounts[Math.min(probes, accounts.length - 1)] ?? null;
            probes += 1;
            return Promise.resolve({ account, models: [], usage: null });
          },
        },
        logger: createMemoryLogger(),
        write: (line) => lines.push(JSON.parse(line)),
        version: "0.1.0",
      });
      await rpc.handleLine(JSON.stringify(initialize));
      expect(lines.at(-1)).toMatchObject({
        result: { account: { authenticated: false, label: null } },
      });
      await rpc.handleLine(JSON.stringify({ method: "initialized" }));
      const models = { id: "m", method: "catalog.models", params: {} };
      vi.advanceTimersByTime(61_000);
      await rpc.handleLine(JSON.stringify(models));
      vi.advanceTimersByTime(61_000);
      await rpc.handleLine(JSON.stringify(models));
      expect(probes).toBe(3);
      const updates = lines.filter(
        (line) => (line as { readonly method?: unknown }).method === "account.updated",
      );
      expect(updates).toEqual([
        { method: "account.updated", params: { account: { authenticated: true, label: "max" } } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("negotiates v1 and rejects other versions without exiting", async () => {
    const { rpc, lines } = server();
    await rpc.handleLine(
      JSON.stringify({ ...initialize, params: { ...initialize.params, protocolVersion: 2 } }),
    );
    expect(lines.at(-1)).toEqual({
      id: "codewide-companion-initialize",
      error: { code: -32600, message: "agent protocol version mismatch", data: null },
    });
    await rpc.handleLine(JSON.stringify(initialize));
    expect(lines.at(-1)).toMatchObject({
      id: "codewide-companion-initialize",
      result: {
        protocolVersion: 1,
        provider: { id: "claude", displayName: "Claude", modelProvider: "anthropic" },
        capabilities: {
          "turns.startWhileActive": "busy",
          "threads.hostMintedIds": true,
          review: false,
        },
        account: { authenticated: true, label: "max" },
      },
    });
  });

  it("requires initialize, echoes string ids and maps errors", async () => {
    const { rpc, lines } = server();
    await rpc.handleLine(
      JSON.stringify({
        id: "codewide-stdio:1",
        method: "thread.read",
        params: { appThreadId: "x" },
      }),
    );
    expect(lines.at(-1)).toMatchObject({
      id: "codewide-stdio:1",
      error: { code: -32600, message: "initialize first" },
    });
    await rpc.handleLine(JSON.stringify(initialize));
    await rpc.handleLine(
      JSON.stringify({ id: "codewide-stdio:2", method: "thread/start", params: {} }),
    );
    expect(lines.at(-1)).toMatchObject({ id: "codewide-stdio:2", error: { code: -32601 } });
    await rpc.handleLine(
      JSON.stringify({ id: "codewide-stdio:3", method: "thread.read", params: {} }),
    );
    expect(lines.at(-1)).toMatchObject({
      id: "codewide-stdio:3",
      error: { code: -32602, message: "params.appThreadId: expected string" },
    });
    await rpc.handleLine(
      JSON.stringify({
        id: "codewide-stdio:4",
        method: "thread.read",
        params: { appThreadId: "missing" },
      }),
    );
    expect(lines.at(-1)).toEqual({
      id: "codewide-stdio:4",
      error: { code: -32600, message: "thread not found: missing", data: null },
    });
    await rpc.handleLine(
      JSON.stringify({
        id: 5,
        method: "capability.invoke",
        params: { capability: "goals", method: "thread/goal/get", params: {} },
      }),
    );
    expect(lines.at(-1)).toEqual({
      id: 5,
      error: {
        code: -32072,
        message: "goals is not supported by this thread's agent",
        data: { capability: "goals", provider: "claude" },
      },
    });
    await rpc.handleLine(
      JSON.stringify({
        id: 6,
        method: "thread.create",
        params: {
          appThreadId: "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d70",
          cwd: "/w",
          settings: { model: "m", effort: null, permissionProfile: ":plan", serviceTier: null },
        },
      }),
    );
    expect(lines.at(-1)).toEqual({
      id: 6,
      error: {
        code: -32602,
        message: "Unsupported permission profile for Claude: :plan",
        data: null,
      },
    });
    await rpc.handleLine("not json");
    expect(lines.at(-1)).toMatchObject({ id: null, error: { code: -32700 } });
  });

  it("buffers events until initialized and never sends requests", async () => {
    const { rpc, lines } = server();
    await rpc.handleLine(JSON.stringify(initialize));
    await rpc.handleLine(
      JSON.stringify({
        id: 7,
        method: "thread.create",
        params: {
          appThreadId: "0199a3c4-7a8e-7b2c-9d1e-2f3a4b5c6d71",
          cwd: "/w",
          settings: {
            model: "m",
            effort: null,
            permissionProfile: ":workspace",
            serviceTier: null,
          },
        },
      }),
    );
    expect(
      lines.some(
        (line) =>
          typeof line === "object" && line !== null && Reflect.get(line, "method") === "event",
      ),
    ).toBe(false);
    rpc.emit({ type: "capability.event", appThreadId: null, capability: "x", payload: null });
    await rpc.handleLine(JSON.stringify({ method: "initialized" }));
    const events = lines.filter(
      (line) =>
        typeof line === "object" && line !== null && Reflect.get(line, "method") === "event",
    );
    expect(events).toHaveLength(1);
    expect(
      lines.every(
        (line) =>
          typeof line === "object" &&
          line !== null &&
          (Reflect.get(line, "method") === undefined || Reflect.get(line, "method") === "event"),
      ),
    ).toBe(true);
  });
});
