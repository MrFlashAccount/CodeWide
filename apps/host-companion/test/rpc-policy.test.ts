import { describe, expect, it } from "vitest";

import { RpcPolicySession, exposedRpcMethods, requiredScopeForRpc } from "../src/index.js";

describe("RpcPolicySession", () => {
  it("requires initialize and initialized before V1 methods", () => {
    const policy = new RpcPolicySession();
    expect(policy.evaluate('{"id":1,"method":"thread/list","params":{}}')).toEqual(
      expect.objectContaining({ action: "close", reason: "initialize_required" }),
    );

    const initialized = new RpcPolicySession();
    expect(initialized.evaluate('{"id":1,"method":"initialize","params":{}}').action).toBe("allow");
    expect(initialized.evaluate('{"id":2,"method":"thread/list","params":{}}')).toEqual(
      expect.objectContaining({ action: "reject" }),
    );
    expect(initialized.evaluate('{"method":"initialized"}').action).toBe("allow");
    expect(initialized.evaluate('{"id":2,"method":"thread/list","params":{}}').action).toBe("allow");
  });

  it.each([
    "fs/readFile",
    "fs/writeFile",
    "fs/remove",
    "process/spawn",
    "config/value/write",
    "account/logout",
    "remoteControl/enable",
    "plugin/install",
  ])("rejects privileged raw method %s", (method) => {
    const policy = new RpcPolicySession();
    policy.evaluate('{"id":1,"method":"initialize","params":{}}');
    policy.evaluate('{"method":"initialized"}');
    expect(policy.evaluate(JSON.stringify({ id: 2, method, params: {} }))).toEqual({
      action: "reject",
      response: {
        id: 2,
        error: { code: -32601, message: `Method is not exposed by CodeWide: ${method}` },
      },
    });
  });

  it("allows approval responses only after initialization", () => {
    const policy = new RpcPolicySession();
    expect(policy.evaluate('{"id":9,"result":{"decision":"accept"}}').action).toBe("close");
    policy.evaluate('{"id":1,"method":"initialize","params":{}}');
    policy.evaluate('{"method":"initialized"}');
    expect(policy.evaluate('{"id":9,"result":{"decision":"accept"}}').action).toBe("allow");
  });

  it("assigns a capability scope to every remotely exposed non-handshake method", () => {
    const methods = exposedRpcMethods().filter((method) => method !== "initialize" && method !== "initialized");
    expect(methods.filter((method) => requiredScopeForRpc(method) === null)).toEqual([]);
  });

  it.each([
    "thread/realtime/start",
    "thread/realtime/appendAudio",
    "thread/realtime/stop",
  ])("allows realtime dictation RPC %s with the turn-start scope", (method) => {
    const policy = new RpcPolicySession();
    policy.evaluate('{"id":1,"method":"initialize","params":{}}');
    policy.evaluate('{"method":"initialized"}');
    expect(policy.evaluate(JSON.stringify({ id: 2, method, params: {} })).action).toBe("allow");
    expect(requiredScopeForRpc(method)).toBe("turns.start");
  });

  it.each([
    "companion/dictation/start",
    "companion/dictation/append",
    "companion/dictation/appendBatch",
    "companion/dictation/finish",
    "companion/dictation/cancel",
  ])("authorizes host OAuth dictation RPC %s with the turn-start scope", (method) => {
    expect(requiredScopeForRpc(method)).toBe("turns.start");
  });

  it("exposes the companion thread resource projection as read-only thread data", () => {
    const policy = new RpcPolicySession();
    policy.evaluate('{"id":1,"method":"initialize","params":{}}');
    policy.evaluate('{"method":"initialized"}');
    expect(policy.evaluate('{"id":2,"method":"companion/threadResources/read","params":{"threadId":"thread"}}').action).toBe("allow");
    expect(policy.evaluate('{"id":3,"method":"companion/threadChange/read","params":{"threadId":"thread","path":"/workspace/a.ts"}}').action).toBe("allow");
    expect(requiredScopeForRpc("companion/threadResources/read")).toBe("threads.read");
    expect(requiredScopeForRpc("companion/threadChange/read")).toBe("threads.read");
  });

  it("exposes account rate limits as read-only data", () => {
    const policy = new RpcPolicySession();
    policy.evaluate('{"id":1,"method":"initialize","params":{}}');
    policy.evaluate('{"method":"initialized"}');
    expect(policy.evaluate('{"id":2,"method":"account/rateLimits/read","params":{}}').action).toBe("allow");
    expect(requiredScopeForRpc("account/rateLimits/read")).toBe("threads.read");
  });
});
