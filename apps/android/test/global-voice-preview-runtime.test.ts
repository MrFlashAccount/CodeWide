import { afterEach, describe, expect, it, vi } from "vitest";

import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import { createGlobalSupervisorRuntimeIngress } from "../src/data/globalSupervisorRuntimeIngress";
import { createGlobalVoicePreviewRuntime } from "../src/data/globalVoicePreviewRuntime";
import { createV1MicrophoneLeaseRegistry } from "../src/data/v1MicrophoneLease";
import type { WorkspaceSyncSession } from "../src/data/workspace-session";

const HOME = globalSupervisorQualifiedChatRef("home", "supervisor");

function sessionFixture(): WorkspaceSyncSession {
  const value = { connectionId: "home", rpc: vi.fn(), stop: vi.fn() };
  // WHY: RpcClient is an external concrete class, while this runtime test exercises only the
  // WorkspaceSyncSession identity consumed by the injected RPC adapter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as WorkspaceSyncSession;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GlobalVoicePreviewRuntime", () => {
  it("plays a bounded GPT Live sample without opening microphone capture or startup context", async () => {
    vi.useFakeTimers();
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const leases = createV1MicrophoneLeaseRegistry(() => "native-token");
    const acceptAnswer = vi.fn(async () => undefined);
    const stopWebRtc = vi.fn(async () => undefined);
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string, params: unknown) => {
      if (method === "thread/realtime/listVoices") {
        return { voices: { defaultV1: "cove", v1: ["cove", "juniper"] } };
      }
      if (method === "thread/realtime/start") {
        expect(params).toMatchObject({
          clientManagedHandoffs: true,
          includeStartupContext: false,
          initialItems: [],
          outputModality: "audio",
          transport: { sdp: "v=0\r\no=offer", type: "webrtc" },
          voice: "juniper",
        });
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/started",
            params: { threadId: "supervisor", version: "v3" },
          },
          sequence: 1,
          threadId: "supervisor",
        });
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/sdp",
            params: { sdp: "v=0\r\no=answer", threadId: "supervisor" },
          },
          sequence: 2,
          threadId: "supervisor",
        });
      }
      if (method === "thread/realtime/appendSpeech") {
        expect(params).toMatchObject({ threadId: "supervisor" });
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/transcript/done",
            params: {
              role: "assistant",
              text: "Привет! Я твой голосовой ассистент CodeWide.",
              threadId: "supervisor",
            },
          },
          sequence: 3,
          threadId: "supervisor",
        });
      }
      if (method === "thread/realtime/stop") {
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: "supervisor" },
          },
          sequence: 4,
          threadId: "supervisor",
        });
      }
      return undefined;
    });
    const binding = {
      bind: vi.fn(async () => HOME),
      invalidateDeletedConnections: vi.fn(async () => undefined),
      read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reset: vi.fn(async () => undefined),
      restoreDeletedHome: vi.fn(async () => null),
    };
    const identifiers = ["preview", "channel"];
    const runtime = createGlobalVoicePreviewRuntime({
      binding: () => binding,
      enabledConnectionIds: () => ["home"],
      ensureStarted: async () => undefined,
      getSession: () => session,
      getSupervisor: () => ({
        reattachRuntime: vi.fn(async () => undefined),
        replaceConnections: vi.fn(),
        session: () => session,
        stop: vi.fn(),
        subscribeLive,
        unsubscribeLive,
      }),
      ingress,
      isRpcAvailable: () => true,
      microphoneLeases: leases,
      randomUUID: () => identifiers.shift() ?? "unexpected",
      rpcAfterAttach,
      startWebRtc: vi.fn(async ({ mode }) => {
        expect(mode).toBe("preview");
        return {
          acceptAnswer,
          offerSdp: "v=0\r\no=offer",
          setMicrophoneMuted: vi.fn(async () => undefined),
          stop: stopWebRtc,
        };
      }),
    });

    const play = runtime.play("juniper");
    await vi.waitFor(() => {
      expect(rpcAfterAttach).toHaveBeenCalledWith(
        session,
        "thread/realtime/appendSpeech",
        expect.any(Object),
      );
    });
    await vi.advanceTimersByTimeAsync(700);
    await expect(play).resolves.toBeUndefined();

    expect(acceptAnswer).toHaveBeenCalledWith("v=0\r\no=answer");
    expect(stopWebRtc).toHaveBeenCalledOnce();
    expect(unsubscribeLive).toHaveBeenCalledWith("home", "channel");
    expect(leases.currentOwner()).toBeNull();
  });

  it("rejects a voice missing from the server catalog before acquiring audio", async () => {
    const session = sessionFixture();
    const leases = createV1MicrophoneLeaseRegistry(() => "native-token");
    const startWebRtc = vi.fn(async () => ({
      acceptAnswer: vi.fn(async () => undefined),
      offerSdp: "v=0\r\no=offer",
      setMicrophoneMuted: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    }));
    const runtime = createGlobalVoicePreviewRuntime({
      binding: () => ({
        bind: vi.fn(async () => HOME),
        invalidateDeletedConnections: vi.fn(async () => undefined),
        read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reset: vi.fn(async () => undefined),
        restoreDeletedHome: vi.fn(async () => null),
      }),
      enabledConnectionIds: () => ["home"],
      ensureStarted: async () => undefined,
      getSession: () => session,
      getSupervisor: () => ({
        reattachRuntime: vi.fn(async () => undefined),
        replaceConnections: vi.fn(),
        session: () => session,
        stop: vi.fn(),
        subscribeLive: vi.fn(async () => undefined),
        unsubscribeLive: vi.fn(async () => undefined),
      }),
      ingress: createGlobalSupervisorRuntimeIngress(),
      isRpcAvailable: () => true,
      microphoneLeases: leases,
      randomUUID: () => "unused",
      rpcAfterAttach: vi.fn(async () => ({ voices: { defaultV1: "cove", v1: ["cove"] } })),
      startWebRtc,
    });

    await expect(runtime.play("vale")).rejects.toThrow("selected Global Voice is unavailable");
    expect(leases.currentOwner()).toBeNull();
    expect(startWebRtc).not.toHaveBeenCalled();
  });

  it("rejects an authentication error emitted before realtime startup without waiting", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const leases = createV1MicrophoneLeaseRegistry(() => "native-token");
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string) => {
      if (method === "thread/realtime/listVoices") {
        return { voices: { defaultV1: "cove", v1: ["cove"] } };
      }
      if (method === "thread/realtime/start") {
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/error",
            params: {
              message: "realtime conversation requires API key auth",
              threadId: "supervisor",
            },
          },
          sequence: 1,
          threadId: "supervisor",
        });
      }
      return undefined;
    });
    const identifiers = ["preview", "channel"];
    const runtime = createGlobalVoicePreviewRuntime({
      binding: () => ({
        bind: vi.fn(async () => HOME),
        invalidateDeletedConnections: vi.fn(async () => undefined),
        read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reset: vi.fn(async () => undefined),
        restoreDeletedHome: vi.fn(async () => null),
      }),
      enabledConnectionIds: () => ["home"],
      ensureStarted: async () => undefined,
      getSession: () => session,
      getSupervisor: () => ({
        reattachRuntime: vi.fn(async () => undefined),
        replaceConnections: vi.fn(),
        session: () => session,
        stop: vi.fn(),
        subscribeLive,
        unsubscribeLive: vi.fn(async () => undefined),
      }),
      ingress,
      isRpcAvailable: () => true,
      microphoneLeases: leases,
      randomUUID: () => identifiers.shift() ?? "unexpected",
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    await expect(runtime.play("cove")).rejects.toThrow(
      "realtime conversation requires API key auth",
    );
    expect(leases.currentOwner()).toBeNull();
  });
});
