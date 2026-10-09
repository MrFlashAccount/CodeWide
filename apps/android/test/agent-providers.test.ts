import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { accountsSectionTitle } from "../src/data/account-usage-presentation";
import {
  accountPoolOwnerName,
  hostDeclaresCapability,
  parseAgentProvidersResult,
} from "../src/data/agentProviders";
import { createAgentProvidersResource } from "../src/data/agentProvidersResource";
import { createVoiceAssistantModelCatalog } from "../src/data/voiceAssistantModelCatalog";
import { agentProviderStatusLines } from "../src/features/connections/agentProviderPresentation";

const providers = {
  hostCapabilities: { "accounts.pool": true, realtimeVoice: true, review: true },
  providers: [
    {
      auth: "unknown",
      capabilities: { "accounts.pool": true, "turns.startWhileActive": "nativeJoin" },
      id: "codex",
      name: "Codex",
      planLabel: null,
      primary: true,
      status: "live",
    },
    {
      auth: "authenticated",
      capabilities: { "accounts.pool": false, "turns.startWhileActive": "busy" },
      id: "claude",
      name: "Claude",
      planLabel: "max",
      primary: false,
      status: "live",
    },
  ],
};

function withClaude(entry: Record<string, unknown>) {
  return { ...providers, providers: [providers.providers[0], { ...providers.providers[1], ...entry }] };
}

describe("agent provider list", () => {
  it("validates the wire shape", () => {
    const parsed = parseAgentProvidersResult(providers);
    expect(parsed?.hostCapabilities).toEqual(["accounts.pool", "realtimeVoice", "review"]);
    expect(parsed?.providers[1]).toEqual({
      auth: "authenticated",
      capabilities: ["turns.startWhileActive"],
      id: "claude",
      name: "Claude",
      planLabel: "max",
      primary: false,
      status: "live",
    });
    expect(parseAgentProvidersResult(withClaude({ status: "sleeping" }))).toBeNull();
    expect(parseAgentProvidersResult(withClaude({ capabilities: null, status: "disabled" }))?.providers[1]?.capabilities).toBeNull();
    expect(parseAgentProvidersResult({ providers: "x", hostCapabilities: {} })).toBeNull();
  });

  it("presents provider status, not pool accounts, and only for several providers", () => {
    const ready = (value: unknown) => {
      const parsed = parseAgentProvidersResult(value);
      if (parsed === null) throw new Error("fixture must parse");
      return { status: "ready" as const, value: parsed };
    };
    expect(agentProviderStatusLines(ready(providers)).map((line) => line.label)).toEqual([
      "Codex · connected",
      "Claude · signed in · Max",
    ]);
    const signedOut = agentProviderStatusLines(
      ready(withClaude({ auth: "unauthenticated", planLabel: null })),
    )[1];
    expect(signedOut).toEqual({
      id: "claude",
      label: "Claude · not signed in — run `claude` on the server to sign in",
      warning: true,
    });
    expect(agentProviderStatusLines(ready(withClaude({ status: "unavailable" })))[1]?.label).toBe(
      "Claude · unavailable on this server",
    );
    expect(
      agentProviderStatusLines(ready({ ...providers, providers: [providers.providers[0]] })),
    ).toEqual([]);
    expect(agentProviderStatusLines({ status: "unsupported" })).toEqual([]);
  });

  it("names the account pool owner only in multi-provider mode", () => {
    const parsed = parseAgentProvidersResult(providers);
    if (parsed === null) throw new Error("fixture must parse");
    expect(accountPoolOwnerName({ status: "ready", value: parsed })).toBe("Codex");
    expect(accountPoolOwnerName({ status: "unsupported" })).toBeNull();
    expect(accountsSectionTitle(["Codex"])).toBe("Codex accounts");
    expect(accountsSectionTitle(["Codex", null])).toBe("Accounts");
    expect(accountsSectionTitle([])).toBe("Accounts");
    expect(hostDeclaresCapability({ status: "ready", value: parsed }, "realtimeVoice")).toBe(true);
    expect(hostDeclaresCapability({ status: "ready", value: parsed }, "goals")).toBe(false);
    expect(hostDeclaresCapability(undefined, "realtimeVoice")).toBeNull();
  });

  it("reads, shares in-flight reads, applies notifications and treats an old Companion as unsupported", async () => {
    let answer: () => Promise<unknown> = async () => providers;
    const rpcAfterAttach = vi.fn(async () => answer());
    const resource = createAgentProvidersResource({
      // WHY: the session is passed through to the mocked RPC only.
      getSession: () => ({}) as never,
      // WHY: the mock answers the single provider-list method.
      rpcAfterAttach: rpcAfterAttach as never,
    });
    await Promise.all([resource.refresh("server"), resource.refresh("server")]);
    expect(rpcAfterAttach).toHaveBeenCalledTimes(1);
    expect(resource.state$.server?.peek()?.status).toBe("ready");
    expect(resource.applyChanged("server", withClaude({ status: "reconnecting" }))).toBe(true);
    const state = resource.state$.server?.peek();
    expect(state?.status === "ready" ? state.value.providers[1]?.status : null).toBe("reconnecting");
    expect(resource.applyChanged("server", { providers: 1 })).toBe(false);
    answer = async () => {
      throw new RpcResponseError(-32_601, "Method not found");
    };
    await resource.refresh("old");
    expect(resource.state$.old?.peek()).toEqual({ status: "unsupported" });
    answer = async () => {
      throw new Error("offline");
    };
    await expect(resource.refresh("server")).rejects.toThrow("offline");
    const failed = resource.state$.server?.peek();
    expect(failed?.status).toBe("error");
    expect(failed?.status === "error" ? failed.value?.providers.length : null).toBe(2);
  });
});

describe("voice assistant model catalog", () => {
  const model = (id: string) => ({
    defaultEffort: "high",
    efforts: ["high"],
    id,
    isDefault: true,
    label: id,
    provider: null,
    supportsPersonality: false,
  });

  it("never keeps another server's models", async () => {
    let connectionId = "first";
    let fail = false;
    const catalog = createVoiceAssistantModelCatalog(
      async () => connectionId,
      async (id) => {
        if (fail) throw new Error("offline");
        return [model(`${id}-model`)];
      },
    );
    await catalog.refresh();
    expect(catalog.snapshot$.value.peek()).toMatchObject({
      connectionId: "first",
      models: [{ id: "first-model" }],
      status: "ready",
    });
    fail = true;
    await catalog.refresh();
    expect(catalog.snapshot$.value.peek()).toMatchObject({
      connectionId: "first",
      models: [{ id: "first-model" }],
      status: "error",
    });
    connectionId = "second";
    await catalog.refresh();
    expect(catalog.snapshot$.value.peek()).toMatchObject({
      connectionId: "second",
      models: [],
      status: "error",
    });
    fail = false;
    await catalog.refresh();
    expect(catalog.snapshot$.value.peek()).toMatchObject({
      connectionId: "second",
      models: [{ id: "second-model" }],
      status: "ready",
    });
  });
});
