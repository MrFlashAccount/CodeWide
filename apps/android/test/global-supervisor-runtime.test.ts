import { RpcResponseError } from "@codewide/sync-client";
import { describe, expect, it, vi } from "vitest";

import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";
import type {
  GlobalSupervisorAttentionEvent,
  GlobalSupervisorAttentionOwner,
} from "../src/data/globalSupervisorAttention";
import { createGlobalSupervisorRuntime } from "../src/data/globalSupervisorRuntime";
import { createGlobalSupervisorRuntimeIngress } from "../src/data/globalSupervisorRuntimeIngress";
import { createV1MicrophoneLeaseRegistry } from "../src/data/v1MicrophoneLease";
import type { WorkspaceSyncSession } from "../src/data/workspace-session";

const HOME = globalSupervisorQualifiedChatRef("home", "supervisor");
const REALTIME_VOICES = {
  voices: {
    defaultV1: "cove",
    defaultV2: "marin",
    v1: ["juniper", "cove"],
    v2: ["marin"],
  },
} as const;

function sessionFixture(): WorkspaceSyncSession {
  const value = { connectionId: "home", rpc: vi.fn(), stop: vi.fn() };
  // WHY: RpcClient is an external concrete class, while this runtime test exercises only the
  // WorkspaceSyncSession methods consumed by the injected RPC adapter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as WorkspaceSyncSession;
}

function attentionFixture(): GlobalSupervisorAttentionOwner {
  return {
    acknowledge: vi.fn(async () => undefined),
    beginWorkerCreation: vi.fn(async () => undefined),
    close: vi.fn(),
    completeWorkerCreation: vi.fn(async () => undefined),
    disableDelivery: vi.fn(async () => undefined),
    enableDelivery: vi.fn(async () => undefined),
    follow: vi.fn(async () => undefined),
    ingestEvents: vi.fn(async () => undefined),
    ingestPendingRequests: vi.fn(async () => undefined),
    ingestSnapshot: vi.fn(async () => undefined),
    pending: vi.fn(async () => []),
    pendingCount: vi.fn(async () => 0),
    ready: Promise.resolve(),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    subscribeAll: vi.fn(() => ({ unsubscribe: vi.fn() })),
    unfollow: vi.fn(async () => undefined),
  };
}

describe("GlobalSupervisorRuntime", () => {
  it("classifies a reconnecting home before issuing the voice capability RPC", async () => {
    const session = sessionFixture();
    const rpcAfterAttach = vi.fn(async () => REALTIME_VOICES);
    const runtime = createGlobalSupervisorRuntime({
      attention: attentionFixture(),
      acquireForegroundLease: async () => ({
        release: vi.fn(async () => undefined),
        setPlaybackLevel: vi.fn(),
      }),
      binding: () => ({
        bind: vi.fn(async () => HOME),
        invalidateDeletedConnections: vi.fn(async () => undefined),
        read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reset: vi.fn(async () => undefined),
      }),
      enabledConnectionIds: () => ["home"],
      ensureStarted: async () => undefined,
      getSession: () => session,
      getSupervisor: () => null,
      ingress: createGlobalSupervisorRuntimeIngress(),
      isRpcAvailable: () => false,
      microphoneLeases: createV1MicrophoneLeaseRegistry(() => "native-token"),
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => "activation",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    await expect(runtime.prepare(() => undefined)).resolves.toEqual({
      failure: "homeUnavailable",
      recovery: "reconnectHome",
      status: "failed",
    });
    expect(runtime.isActive()).toBe(false);
    expect(rpcAfterAttach).not.toHaveBeenCalled();
  });

  it("negotiates WebRTC through app-server and performs ordered terminal cleanup", async () => {
    let now = 0;
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const acceptAnswer = vi.fn(async () => undefined);
    const stopWebRtc = vi.fn(async () => undefined);
    const setMicrophoneMuted = vi.fn(async () => undefined);
    const foregroundRelease = vi.fn(async () => undefined);
    const setPlaybackLevel = vi.fn();
    const finishAttentionStop = Promise.withResolvers<void>();
    const finishRemoteStop = Promise.withResolvers<void>();
    const calls: string[] = [];
    const published: Array<{ readonly event: string }> = [];
    let publishPlaybackLevel: (level: number) => void = () => undefined;
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      calls.push("subscribe");
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      calls.push("unsubscribe");
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string, params: unknown) => {
      calls.push(method);
      if (method === "thread/realtime/listVoices") {
        return REALTIME_VOICES;
      }
      if (method === "thread/realtime/start") {
        expect(params).toMatchObject({
          includeStartupContext: false,
          outputModality: "audio",
          realtimeStartInstructions: expect.stringMatching(
            /every standard Codex capability[\s\S]*Calm and candid/,
          ),
          transport: { sdp: "v=0\r\no=offer", type: "webrtc" },
          version: "v3",
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
      if (method === "thread/realtime/appendText") {
        expect(params).toMatchObject({
          role: "developer",
          text: expect.stringMatching(/greet the user briefly[\s\S]*anything interesting/),
          threadId: "supervisor",
        });
      }
      if (method === "thread/realtime/stop") {
        await finishRemoteStop.promise;
        ingress.publishLive("home", {
          channelId: "channel",
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: "supervisor" },
          },
          sequence: 5,
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
    };
    const microphoneLeases = createV1MicrophoneLeaseRegistry(() => "native-token");
    const recordStartupStage = vi.fn();
    const attention = attentionFixture();
    vi.mocked(attention.enableDelivery).mockImplementation(async () => {
      calls.push("attention-on");
    });
    vi.mocked(attention.disableDelivery).mockImplementation(async () => {
      calls.push("attention-off");
      await finishAttentionStop.promise;
    });
    let uuidIndex = 0;
    const runtime = createGlobalSupervisorRuntime({
      attention,
      acquireForegroundLease: async () => ({
        release: foregroundRelease,
        setPlaybackLevel,
      }),
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
      microphoneLeases,
      now: () => now,
      personality: async () => ({
        character: "Calm and candid",
        communicationStyle: "Use short spoken answers",
        rules: "State uncertainty clearly",
      }),
      preferredVoice: async () => "juniper",
      randomUUID: () => {
        uuidIndex += 1;
        return uuidIndex === 1 ? "activation" : "channel";
      },
      recordStartupStage,
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async ({ mode, onPlaybackLevel }) => {
        calls.push("webrtc");
        expect(mode).toBe("interactive");
        publishPlaybackLevel = onPlaybackLevel;
        return {
          acceptAnswer: async (sdp) => {
            calls.push("answer");
            await acceptAnswer(sdp);
          },
          offerSdp: "v=0\r\no=offer",
          setMicrophoneMuted,
          stop: async () => {
            calls.push("media-stop");
            await stopWebRtc();
          },
        };
      }),
    });

    await expect(runtime.prepare(() => undefined)).resolves.toEqual({
      home: HOME,
      status: "ready",
    });
    const activation = await runtime.start(HOME, (event) => published.push(event));
    expect(attention.enableDelivery).toHaveBeenCalledWith(HOME);
    expect(runtime.isActive()).toBe(true);
    expect(microphoneLeases.currentOwner()).toEqual({
      activationId: "activation",
      kind: "globalSupervisor",
    });
    ingress.publishLive("home", {
      channelId: "channel",
      event: "payload",
      payload: {
        method: "thread/realtime/itemAdded",
        params: { item: { role: "assistant", type: "message" }, threadId: "supervisor" },
      },
      sequence: 3,
      threadId: "supervisor",
    });
    publishPlaybackLevel(0.73);
    ingress.publishLive("home", {
      channelId: "channel",
      event: "payload",
      payload: {
        method: "thread/realtime/transcript/done",
        params: { role: "assistant", text: "Done", threadId: "supervisor" },
      },
      sequence: 4,
      threadId: "supervisor",
    });
    expect(published.at(-1)?.event).toBe("transcript");
    expect(setPlaybackLevel).toHaveBeenLastCalledWith(0.73);
    now += 500;
    publishPlaybackLevel(0);
    expect(
      published
        .map((event) => event.event)
        .filter((event) => ["listening", "thinking", "speaking"].includes(event)),
    ).toEqual(["listening", "thinking", "speaking", "listening"]);

    ingress.publishThreadEvents("home", [
      {
        cursor: "1",
        payload: {
          method: "turn/started",
          params: { threadId: "supervisor", turn: { id: "hidden-turn" } },
        },
      },
    ]);
    expect(published.at(-1)?.event).toBe("thinking");
    publishPlaybackLevel(0.1);
    expect(published.at(-1)?.event).toBe("speaking");
    ingress.publishThreadEvents("home", [
      {
        cursor: "2",
        payload: {
          method: "turn/completed",
          params: { threadId: "supervisor", turn: { id: "hidden-turn" } },
        },
      },
    ]);
    expect(published.at(-1)?.event).toBe("speaking");
    now += 500;
    publishPlaybackLevel(0);
    expect(published.at(-1)?.event).toBe("listening");

    await activation.setMicrophoneMuted(true);
    await activation.setMicrophoneMuted(false);
    expect(setMicrophoneMuted.mock.calls).toEqual([[true], [false]]);
    expect(stopWebRtc).not.toHaveBeenCalled();
    expect(runtime.isActive()).toBe(true);

    const stopping = activation.stop();
    expect(runtime.isActive()).toBe(false);
    await vi.waitFor(() => expect(stopWebRtc).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(microphoneLeases.currentOwner()).toBeNull());
    expect(foregroundRelease).toHaveBeenCalledOnce();
    expect(unsubscribeLive).not.toHaveBeenCalled();
    finishAttentionStop.resolve();
    finishRemoteStop.resolve();
    await stopping;
    await activation.stop();
    expect(attention.disableDelivery).toHaveBeenCalledWith(HOME);

    expect(acceptAnswer).toHaveBeenCalledWith("v=0\r\no=answer");
    expect(stopWebRtc).toHaveBeenCalledOnce();
    expect(recordStartupStage.mock.calls.map(([event]) => event.stage).sort()).toEqual([
      "activationCreated",
      "offerReady",
      "peerConnected",
      "realtimeStarted",
      "sdpReceived",
      "startAccepted",
      "subscriptionReady",
    ]);
    expect(unsubscribeLive).toHaveBeenCalledWith("home", "channel");
    expect(microphoneLeases.currentOwner()).toBeNull();
    expect(calls).toEqual([
      "thread/realtime/listVoices",
      "attention-on",
      "thread/realtime/listVoices",
      "webrtc",
      "subscribe",
      "thread/realtime/start",
      "answer",
      "thread/realtime/appendText",
      "media-stop",
      "attention-off",
      "thread/realtime/stop",
      "unsubscribe",
    ]);
  });

  it("preserves one activation, supervisor thread, and overlay lease across a VPN route change", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const foregroundRelease = vi.fn(async () => undefined);
    const published: Array<{ readonly activationId: string; readonly event: string }> = [];
    const terminalCallbacks: Array<() => void> = [];
    const realtimeStarts: unknown[] = [];
    const realtimeAppends: unknown[] = [];
    let pendingAttention: readonly GlobalSupervisorAttentionEvent[] = [];
    let activeChannel = "";
    let nextSequence = 1;
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      activeChannel = channelId;
      nextSequence = 1;
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string, params: unknown) => {
      if (method === "thread/realtime/listVoices") return REALTIME_VOICES;
      if (method === "thread/realtime/start") {
        realtimeStarts.push(params);
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/started",
            params: { threadId: HOME.threadId, version: "v3" },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/sdp",
            params: { sdp: "v=0\r\no=answer", threadId: HOME.threadId },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
      }
      if (method === "thread/realtime/appendText") {
        realtimeAppends.push(params);
      }
      if (method === "thread/realtime/stop") {
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: HOME.threadId },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
      }
      return undefined;
    });
    const identifiers = ["logical-activation", "channel-before-vpn", "channel-after-vpn"];
    const attention = attentionFixture();
    vi.mocked(attention.pending).mockImplementation(async (_home, limit = 32) =>
      pendingAttention.slice(0, limit),
    );
    vi.mocked(attention.acknowledge).mockImplementation(async (_home, eventId) => {
      pendingAttention = pendingAttention.filter((event) => event.eventId !== eventId);
    });
    const runtime = createGlobalSupervisorRuntime({
      attention,
      acquireForegroundLease: async () => ({
        release: foregroundRelease,
        setPlaybackLevel: vi.fn(),
      }),
      binding: () => ({
        bind: vi.fn(async () => HOME),
        invalidateDeletedConnections: vi.fn(async () => undefined),
        read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
        reset: vi.fn(async () => undefined),
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
        unsubscribeLive,
      }),
      ingress,
      isRpcAvailable: () => true,
      microphoneLeases: createV1MicrophoneLeaseRegistry(() => "microphone-lease"),
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => identifiers.shift() ?? "unexpected-id",
      reconnectPolicy: { retryDelaysMs: [0] },
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async ({ onTerminal }) => {
        terminalCallbacks.push(onTerminal);
        return {
          acceptAnswer: vi.fn(async () => undefined),
          offerSdp: "v=0\r\no=offer",
          setMicrophoneMuted: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
        };
      }),
    });

    const activation = await runtime.start(HOME, (event) => published.push(event));
    ingress.publishLive("home", {
      channelId: activeChannel,
      event: "payload",
      payload: {
        method: "thread/realtime/transcript/done",
        params: { role: "user", text: "Keep this question", threadId: HOME.threadId },
      },
      sequence: nextSequence++,
      threadId: HOME.threadId,
    });
    ingress.publishLive("home", {
      channelId: activeChannel,
      event: "payload",
      payload: {
        method: "thread/realtime/transcript/done",
        params: { role: "assistant", text: "Keep this answer", threadId: HOME.threadId },
      },
      sequence: nextSequence++,
      threadId: HOME.threadId,
    });
    pendingAttention = [
      {
        eventId: "worker-completed",
        kind: "completed",
        observedAt: 1,
        sourceCursor: 9,
        summary: "Worker completed while the route changed.",
        supervisor: HOME,
        turnId: "worker-turn",
        worker: globalSupervisorQualifiedChatRef("worker-home", "worker-thread"),
      },
    ];
    terminalCallbacks[0]?.();

    await vi.waitFor(() => expect(realtimeStarts).toHaveLength(2));
    expect(activation).toMatchObject({ activationId: "logical-activation", home: HOME });
    expect(runtime.isActive()).toBe(true);
    expect(published.map((event) => event.event)).toContain("reconnecting");
    expect(published.at(-1)).toMatchObject({
      activationId: "logical-activation",
      event: "listening",
    });
    expect(realtimeStarts).toEqual([
      expect.objectContaining({ initialItems: [], threadId: "supervisor" }),
      expect.objectContaining({
        includeStartupContext: false,
        initialItems: [
          { role: "user", text: "Keep this question" },
          { role: "assistant", text: "Keep this answer" },
          expect.objectContaining({
            role: "developer",
            text: expect.stringContaining('eventId="worker-completed"'),
          }),
        ],
        threadId: "supervisor",
      }),
    ]);
    await vi.waitFor(() => expect(realtimeAppends).toHaveLength(2));
    expect(realtimeAppends[0]).toMatchObject({
      role: "developer",
      text: expect.stringMatching(/greet the user briefly[\s\S]*anything interesting/),
      threadId: "supervisor",
    });
    expect(realtimeAppends[1]).toMatchObject({
      role: "developer",
      text: expect.stringMatching(/already present in startup context[\s\S]*worker-completed/),
      threadId: "supervisor",
    });
    expect(JSON.stringify(realtimeAppends[1])).not.toContain(
      "Worker completed while the route changed.",
    );
    expect(
      realtimeAppends.filter((payload) =>
        JSON.stringify(payload).includes("greet the user briefly"),
      ),
    ).toHaveLength(1);
    expect(foregroundRelease).not.toHaveBeenCalled();

    await activation.stop();
    expect(foregroundRelease).toHaveBeenCalledOnce();
  });

  it("hands the microphone to dictation and resumes the same logical supervisor", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const leases = createV1MicrophoneLeaseRegistry(() => "microphone-lease");
    const foregroundRelease = vi.fn(async () => undefined);
    const realtimeStarts: Array<{ readonly threadId?: string }> = [];
    let activeChannel = "";
    let activeTransports = 0;
    let maximumActiveTransports = 0;
    let nextSequence = 1;
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      activeChannel = channelId;
      nextSequence = 1;
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string, params: unknown) => {
      if (method === "thread/realtime/listVoices") return REALTIME_VOICES;
      if (method === "thread/realtime/start") {
        if (
          typeof params === "object" &&
          params !== null &&
          "threadId" in params &&
          typeof params.threadId === "string"
        ) {
          realtimeStarts.push({ threadId: params.threadId });
        }
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/started",
            params: { threadId: HOME.threadId, version: "v3" },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/sdp",
            params: { sdp: "v=0\r\no=answer", threadId: HOME.threadId },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
      }
      if (method === "thread/realtime/stop") {
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: HOME.threadId },
          },
          sequence: nextSequence++,
          threadId: HOME.threadId,
        });
      }
      return undefined;
    });
    const identifiers = [
      "logical-activation",
      "channel-before-dictation",
      "channel-after-dictation",
    ];
    const runtime = createGlobalSupervisorRuntime({
      attention: attentionFixture(),
      acquireForegroundLease: async () => ({
        release: foregroundRelease,
        setPlaybackLevel: vi.fn(),
      }),
      binding: () => {
        throw new Error("unused");
      },
      enabledConnectionIds: () => [],
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
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => identifiers.shift() ?? "unexpected-id",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => {
        activeTransports += 1;
        maximumActiveTransports = Math.max(maximumActiveTransports, activeTransports);
        let stopped = false;
        return {
          acceptAnswer: vi.fn(async () => undefined),
          offerSdp: "v=0\r\no=offer",
          setMicrophoneMuted: vi.fn(async () => undefined),
          stop: vi.fn(async () => {
            if (stopped) return;
            stopped = true;
            activeTransports -= 1;
          }),
        };
      }),
    });

    const activation = await runtime.start(HOME, vi.fn());
    const dictation = await leases.acquireDictation("composer");
    if (dictation.status !== "acquired") throw new Error("Expected dictation lease");
    expect(activeTransports).toBe(0);
    expect(leases.state()).toMatchObject({ phase: "dictationOwned" });

    await dictation.lease.release();

    expect(activation).toMatchObject({ activationId: "logical-activation", home: HOME });
    expect(runtime.isActive()).toBe(true);
    expect(realtimeStarts).toEqual([
      expect.objectContaining({ threadId: HOME.threadId }),
      expect.objectContaining({ threadId: HOME.threadId }),
    ]);
    expect(maximumActiveTransports).toBe(1);
    expect(activeTransports).toBe(1);
    expect(foregroundRelease).not.toHaveBeenCalled();
    expect(leases.state()).toEqual({
      assistant: { activationId: "logical-activation", kind: "globalSupervisor" },
      phase: "assistantOwned",
    });

    await activation.stop();
    expect(activeTransports).toBe(0);
    expect(foregroundRelease).toHaveBeenCalledOnce();
  });

  it("replaces an unpersisted bound thread once and starts realtime on the replacement", async () => {
    const replacement = globalSupervisorQualifiedChatRef("home", "replacement");
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const reset = vi.fn(async () => undefined);
    const bind = vi.fn(async () => replacement);
    const binding = {
      bind,
      invalidateDeletedConnections: vi.fn(async () => undefined),
      read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reset,
    };
    let activeChannel = "";
    let activeThread = "";
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      activeChannel = channelId;
      activeThread = threadId;
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const realtimeStart = vi.fn(async () => {
      if (activeThread === HOME.threadId) {
        throw new RpcResponseError(-32_061, "Global supervisor thread is unavailable");
      }
      ingress.publishLive("home", {
        channelId: activeChannel,
        event: "payload",
        payload: {
          method: "thread/realtime/started",
          params: { threadId: activeThread, version: "v3" },
        },
        sequence: 1,
        threadId: activeThread,
      });
      ingress.publishLive("home", {
        channelId: activeChannel,
        event: "payload",
        payload: {
          method: "thread/realtime/sdp",
          params: { sdp: "v=0\r\no=answer", threadId: activeThread },
        },
        sequence: 2,
        threadId: activeThread,
      });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string) => {
      if (method === "thread/realtime/listVoices") {
        return REALTIME_VOICES;
      }
      if (method === "thread/realtime/start") {
        return realtimeStart();
      }
      if (method === "thread/realtime/stop") {
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: activeThread },
          },
          sequence: 3,
          threadId: activeThread,
        });
      }
      return undefined;
    });
    const identifiers = ["activation-old", "channel-old", "activation-new", "channel-new"];
    const runtime = createGlobalSupervisorRuntime({
      attention: attentionFixture(),
      acquireForegroundLease: async () => ({
        release: vi.fn(async () => undefined),
        setPlaybackLevel: vi.fn(),
      }),
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
      microphoneLeases: createV1MicrophoneLeaseRegistry(() => "native-token"),
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => identifiers.shift() ?? "unexpected",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    const activation = await runtime.start(HOME, vi.fn());
    expect(activation.home).toEqual(replacement);
    expect(reset).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledWith("home");
    expect(realtimeStart).toHaveBeenCalledTimes(2);
    await activation.stop();
  });

  it("reads changed personality for the next activation without recreating the bound thread", async () => {
    const ingress = createGlobalSupervisorRuntimeIngress();
    const session = sessionFixture();
    const binding = {
      bind: vi.fn(async () => HOME),
      invalidateDeletedConnections: vi.fn(async () => undefined),
      read: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reconcile: vi.fn(async () => ({ home: HOME, schemaVersion: 1, status: "ready" as const })),
      reset: vi.fn(async () => undefined),
    };
    let currentPersonality = {
      character: "Direct",
      communicationStyle: "Brief",
      rules: "Always answer in English",
    };
    const personality = vi.fn(async () => currentPersonality);
    const compactionReasserted = Promise.withResolvers<void>();
    const appendTextPayloads: unknown[] = [];
    const realtimeStartPayloads: unknown[] = [];
    let activeChannel = "";
    const subscribeLive = vi.fn(async (_connectionId, channelId, threadId) => {
      activeChannel = channelId;
      ingress.publishLive("home", { channelId, event: "subscribed", threadId });
    });
    const unsubscribeLive = vi.fn(async (_connectionId, channelId) => {
      ingress.publishLive("home", { channelId, event: "terminal", reason: "unsubscribed" });
    });
    const rpcAfterAttach = vi.fn(async (_session, method: string, params: unknown) => {
      if (method === "thread/realtime/listVoices") {
        return REALTIME_VOICES;
      }
      if (method === "thread/realtime/start") {
        realtimeStartPayloads.push(params);
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/started",
            params: { threadId: HOME.threadId, version: "v3" },
          },
          sequence: 1,
          threadId: HOME.threadId,
        });
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/sdp",
            params: { sdp: "v=0\r\no=answer", threadId: HOME.threadId },
          },
          sequence: 2,
          threadId: HOME.threadId,
        });
      }
      if (method === "thread/realtime/appendText") {
        appendTextPayloads.push(params);
        if (JSON.stringify(params).includes("Rules:\\nAlways answer in Russian")) {
          compactionReasserted.resolve();
        }
      }
      if (method === "thread/realtime/stop") {
        ingress.publishLive("home", {
          channelId: activeChannel,
          event: "payload",
          payload: {
            method: "thread/realtime/closed",
            params: { threadId: HOME.threadId },
          },
          sequence: 3,
          threadId: HOME.threadId,
        });
      }
      return undefined;
    });
    const identifiers = ["activation-1", "channel-1", "activation-2", "channel-2"];
    const runtime = createGlobalSupervisorRuntime({
      attention: attentionFixture(),
      acquireForegroundLease: async () => ({
        release: vi.fn(async () => undefined),
        setPlaybackLevel: vi.fn(),
      }),
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
      microphoneLeases: createV1MicrophoneLeaseRegistry(() => "native-token"),
      now: () => 0,
      personality,
      preferredVoice: async () => "cove",
      randomUUID: () => identifiers.shift() ?? "unexpected",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    const first = await runtime.start(HOME, vi.fn());
    await first.stop();
    currentPersonality = {
      character: "Calm",
      communicationStyle: "Concise",
      rules: "Always answer in Russian",
    };
    const second = await runtime.start(HOME, vi.fn());
    ingress.publishThreadEvents("home", [
      {
        cursor: 42,
        payload: {
          method: "item/completed",
          params: {
            completedAtMs: 1,
            item: { id: "compaction", type: "contextCompaction" },
            threadId: HOME.threadId,
            turnId: "compaction-turn",
          },
        },
      },
    ]);
    await compactionReasserted.promise;
    await second.stop();

    expect(personality).toHaveBeenCalledTimes(2);
    expect(binding.bind).not.toHaveBeenCalled();
    expect(realtimeStartPayloads).toHaveLength(2);
    expect(realtimeStartPayloads[0]).toMatchObject({
      realtimeStartInstructions: expect.stringContaining("Rules:\nAlways answer in English"),
      threadId: "supervisor",
      voice: "cove",
    });
    expect(realtimeStartPayloads[1]).toMatchObject({
      realtimeStartInstructions: expect.stringContaining("Rules:\nAlways answer in Russian"),
      threadId: "supervisor",
      voice: "cove",
    });
    expect(realtimeStartPayloads[1]).not.toMatchObject({
      realtimeStartInstructions: expect.stringContaining("Always answer in English"),
    });
    expect(appendTextPayloads).toEqual([
      {
        role: "developer",
        text: expect.stringMatching(/greet the user briefly[\s\S]*anything interesting/),
        threadId: "supervisor",
      },
      {
        role: "developer",
        text: expect.stringMatching(/greet the user briefly[\s\S]*anything interesting/),
        threadId: "supervisor",
      },
      {
        role: "developer",
        text: expect.stringContaining("Rules:\nAlways answer in Russian"),
        threadId: "supervisor",
      },
    ]);
  });

  it("rejects a second microphone owner without preempting the first", async () => {
    const leases = createV1MicrophoneLeaseRegistry(() => "dictation-token");
    const dictation = await leases.acquireDictation("composer");
    if (dictation.status !== "acquired") {
      throw new Error("Invalid microphone fixture");
    }
    const session = sessionFixture();
    const runtime = createGlobalSupervisorRuntime({
      attention: attentionFixture(),
      acquireForegroundLease: async () => ({
        release: vi.fn(async () => undefined),
        setPlaybackLevel: vi.fn(),
      }),
      binding: () => {
        throw new Error("unused");
      },
      enabledConnectionIds: () => [],
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
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => "activation",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "granted"),
      rpcAfterAttach: vi.fn(async () => REALTIME_VOICES),
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    await expect(runtime.start(HOME, vi.fn())).rejects.toMatchObject({
      failure: "microphoneBusy",
      recovery: "retryMicrophoneBusy",
    });
    expect(leases.currentOwner()).toEqual({ kind: "dictation", scope: "composer" });
  });

  it("fails before lease acquisition when explicit activation is denied microphone access", async () => {
    const leases = createV1MicrophoneLeaseRegistry(() => "native-token");
    const session = sessionFixture();
    const rpcAfterAttach = vi.fn(async () => REALTIME_VOICES);
    const attention = attentionFixture();
    const runtime = createGlobalSupervisorRuntime({
      attention,
      acquireForegroundLease: async () => ({
        release: vi.fn(async () => undefined),
        setPlaybackLevel: vi.fn(),
      }),
      binding: () => {
        throw new Error("unused");
      },
      enabledConnectionIds: () => [],
      ensureStarted: async () => undefined,
      getSession: () => session,
      getSupervisor: () => null,
      ingress: createGlobalSupervisorRuntimeIngress(),
      isRpcAvailable: () => true,
      microphoneLeases: leases,
      now: () => 0,
      personality: async () => ({ character: "", communicationStyle: "", rules: "" }),
      preferredVoice: async () => "cove",
      randomUUID: () => "activation",
      recordStartupStage: vi.fn(),
      requestMicrophonePermission: vi.fn(async () => "denied"),
      rpcAfterAttach,
      startWebRtc: vi.fn(async () => ({
        acceptAnswer: vi.fn(async () => undefined),
        offerSdp: "v=0\r\no=offer",
        setMicrophoneMuted: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
      })),
    });

    await expect(runtime.start(HOME, vi.fn())).rejects.toMatchObject({
      failure: "microphonePermissionDenied",
      recovery: "retryMicrophoneBusy",
    });
    expect(leases.currentOwner()).toBeNull();
    expect(rpcAfterAttach).not.toHaveBeenCalled();
    expect(attention.enableDelivery).toHaveBeenCalledWith(HOME);
    expect(attention.disableDelivery).toHaveBeenCalledWith(HOME);
  });
});
