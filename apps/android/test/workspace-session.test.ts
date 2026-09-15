import { describe, expect, it } from "vitest";
import type { StoredConnection } from "../src/data/connection-profile-types";
import { createWorkspaceSession } from "../src/data/workspace-session";

function connection(endpoint: string): StoredConnection {
  return {
    id: "server",
    endpoint,
    token: "test-profile-token",
    enabled: true,
    displayName: "Test",
    emoji: "",
    sortOrder: 0,
    state: "live",
    lastError: null,
    lastErrorAt: null,
  };
}

function mint() {
  return Promise.withResolvers<{ sessionToken: string; expiresAt: number }>();
}

describe("V1 workspace session ownership", () => {
  it("shares one credential-qualified mint and reuses its unexpired authorization", async () => {
    const pending = mint();
    const saved = connection("https://one.example");
    const profiles = [saved];
    let calls = 0;
    const sessions = createWorkspaceSession({
      projectConnections: () => profiles,
      mintNativeSession: () => {
        calls += 1;
        return pending.promise;
      },
      randomUUID: () => "test-request",
    });
    expect(sessions.currentConnections()).toBe(profiles);
    const first = sessions.scopedHttpAuthorization(saved);
    const second = sessions.scopedHttpAuthorization(saved);
    expect(calls).toBe(1);
    pending.resolve({ sessionToken: "minted-test-token", expiresAt: Date.now() + 60_000 });
    expect(await first).toBe("Bearer minted-test-token");
    expect(await second).toBe("Bearer minted-test-token");
    expect(await sessions.scopedHttpAuthorization(saved)).toBe("Bearer minted-test-token");
    expect(calls).toBe(1);
  });

  it("invalidates authorization when the endpoint or explicit profile authority changes", async () => {
    let calls = 0;
    const sessions = createWorkspaceSession({
      projectConnections: () => [],
      mintNativeSession: async () => ({
        sessionToken: `mint-${++calls}`,
        expiresAt: Date.now() + 60_000,
      }),
      randomUUID: () => "test-request",
    });
    const original = connection("https://one.example");
    const replacement = connection("https://two.example");
    expect(await sessions.scopedHttpAuthorization(original)).toBe("Bearer mint-1");
    expect(await sessions.scopedHttpAuthorization(replacement)).toBe("Bearer mint-2");
    sessions.forgetHttpAuthorization(replacement.id);
    expect(await sessions.scopedHttpAuthorization(replacement)).toBe("Bearer mint-3");
  });

  it("does not let an older completion clear a replacement mint", async () => {
    const previous = mint();
    const replacement = mint();
    const saved = connection("https://one.example");
    let calls = 0;
    const sessions = createWorkspaceSession({
      projectConnections: () => [saved],
      mintNativeSession: () => (++calls === 1 ? previous.promise : replacement.promise),
      randomUUID: () => "test-request",
    });
    const first = sessions.scopedHttpAuthorization(saved);
    const second = sessions.scopedHttpAuthorization(saved, true);
    previous.resolve({ sessionToken: "expired-test-token", expiresAt: 0 });
    await first;
    const third = sessions.scopedHttpAuthorization(saved);
    expect(calls).toBe(2);
    replacement.resolve({ sessionToken: "replacement-test-token", expiresAt: Date.now() + 60_000 });
    expect(await second).toBe("Bearer replacement-test-token");
    expect(await third).toBe("Bearer replacement-test-token");
  });

  it("clears a failed mint so a later request can recover", async () => {
    const failure = new Error("native proof failed");
    let calls = 0;
    const sessions = createWorkspaceSession({
      projectConnections: () => [],
      mintNativeSession: async () => {
        if (++calls === 1) throw failure;
        return { sessionToken: "recovered-test-token", expiresAt: Date.now() + 60_000 };
      },
      randomUUID: () => "test-request",
    });
    const saved = connection("https://one.example");
    await expect(sessions.scopedHttpAuthorization(saved)).rejects.toBe(failure);
    expect(await sessions.scopedHttpAuthorization(saved)).toBe("Bearer recovered-test-token");
  });
});
